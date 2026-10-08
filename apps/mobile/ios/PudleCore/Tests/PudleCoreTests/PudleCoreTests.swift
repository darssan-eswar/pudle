import XCTest
@testable import PudleCore

private let now = Date(timeIntervalSince1970: 1_791_400_000) // fixed clock
private let convoy = "6b0c1f8e-1d1b-4c4e-9c55-2f8a0d9e3a11"
private let alice = "11111111-1111-4111-8111-111111111111"
private let bob = "22222222-2222-4222-8222-222222222222"

private func iso(_ offset: TimeInterval) -> String { PudleTime.format(now.addingTimeInterval(offset)) }

private func legacyRow(id: String = UUID().uuidString, kind: String = "debris", created: TimeInterval = -5,
                       expires: TimeInterval = 115, convoyID: String = convoy) -> LegacyObstacleRow {
    LegacyObstacleRow(id: id, convoy_id: convoyID, reporter_id: alice, kind: kind,
                      created_at: iso(created), expires_at: iso(expires))
}

private func hazardRow(lat: Double? = nil, lon: Double? = nil, acc: Double? = nil, heading: Double? = nil,
                       version: Int = 1, source: String = "convoy_member", side: String? = "right",
                       blocks: Bool? = false) -> HazardEventRow {
    HazardEventRow(id: UUID().uuidString, schema_version: version, convoy_id: convoy, reporter_id: alice,
                   kind: "tree", source: source, observed_at: iso(-10), created_at: iso(-5), expires_at: iso(895),
                   latitude: lat, longitude: lon, accuracy_m: acc, heading_deg: heading, side: side, blocks_road: blocks)
}

// Charlotte-area fixture, heading due north at 20 m/s.
private let base = (lat: 35.2271, lon: -80.8431)
private func fix(course: Double? = 0, speed: Double? = 20, accuracy: Double = 8, age: TimeInterval = 1) -> ReceiverFix {
    ReceiverFix(latitude: base.lat, longitude: base.lon, accuracyMeters: accuracy, courseDegrees: course,
                speedMetersPerSecond: speed, timestamp: now.addingTimeInterval(-age))
}
private func hazard(meters: Double, bearing: Double, heading: Double? = 0, accuracy: Double = 10) -> HazardLocation {
    let p = TestEvents.offset(latitude: base.lat, longitude: base.lon, meters: meters, bearingDegrees: bearing)
    return HazardLocation(latitude: p.0, longitude: p.1, accuracyMeters: accuracy, headingDegrees: heading)
}

final class DecodingTests: XCTestCase {
    func testPostgresMicrosecondTimestampsParse() {
        let date = PudleTime.parse("2026-10-07T17:12:35.756123+00:00")
        XCTAssertNotNil(date)
        XCTAssertEqual(date!.timeIntervalSince1970, 1_791_393_155.756, accuracy: 0.002)
        XCTAssertNotNil(PudleTime.parse("2026-10-07T17:12:35Z"))
        XCTAssertNil(PudleTime.parse("not-a-date"))
    }

    func testValidLegacyRowBecomesUnlocatedConvoyEvent() throws {
        let event = try EventDecoder.validate(legacyRow(), expectedConvoy: convoy, now: now).get()
        XCTAssertNil(event.location)
        XCTAssertEqual(event.source, .convoyMember)
        XCTAssertTrue(event.id.hasPrefix("legacy:"))
    }

    func testRejectsUnknownKindMalformedIdAndOtherConvoy() {
        XCTAssertEqual(rejection(legacyRow(kind: "ignore previous instructions")), .unknownKind)
        XCTAssertEqual(rejection(legacyRow(id: String(repeating: "x", count: 10_000))), .malformed)
        XCTAssertEqual(rejection(legacyRow(convoyID: UUID().uuidString)), .wrongConvoy)
    }

    func testRejectsStaleFutureExpiredAndOverlongEvents() {
        XCTAssertEqual(rejection(legacyRow(created: 120, expires: 200)), .createdInFuture)
        XCTAssertEqual(rejection(legacyRow(created: -130, expires: -10)), .expired)
        XCTAssertEqual(rejection(legacyRow(created: -5, expires: 3_700)), .lifetimeTooLong)
        XCTAssertEqual(rejection(legacyRow(created: -3_650, expires: 100)), .lifetimeTooLong)
        XCTAssertEqual(rejection(legacyRow(created: 5, expires: 5)), .badTimestamp)
    }

    func testCameraRowKeepsSideAndBlockage() throws {
        let event = try EventDecoder.validate(hazardRow(lat: 35, lon: -80, acc: 12, heading: 90, source: "driver_confirmed_camera",
                                                        side: "left", blocks: true), expectedConvoy: convoy, now: now).get()
        XCTAssertEqual(event.side, .left)
        XCTAssertTrue(event.blocksRoad)
        XCTAssertEqual(event.source, .driverConfirmedCamera)
    }

    func testHazardRowLocationMustBeCompleteAndInRange() {
        XCTAssertNoThrow(try EventDecoder.validate(hazardRow(lat: 35, lon: -80, acc: 12, heading: 90), expectedConvoy: convoy, now: now).get())
        XCTAssertEqual(rejection(hazardRow(lat: 35, lon: nil, acc: 12)), .invalidLocation)
        XCTAssertEqual(rejection(hazardRow(lat: 95, lon: -80, acc: 12)), .invalidLocation)
        XCTAssertEqual(rejection(hazardRow(lat: 35, lon: -80, acc: 12, heading: 400)), .invalidLocation)
        XCTAssertEqual(rejection(hazardRow(heading: 90)), .invalidLocation)
        XCTAssertEqual(rejection(hazardRow(version: 2)), .unsupportedSchema)
        XCTAssertEqual(rejection(hazardRow(source: "camera_model")), .unknownSource)
        XCTAssertEqual(rejection(hazardRow(source: "labeled_test")), .unknownSource)
        XCTAssertEqual(rejection(hazardRow(source: "driver_confirmed_camera")), .invalidLocation)
        XCTAssertEqual(rejection(hazardRow(lat: 35, lon: -80, acc: 12, side: "upward")), .malformed)
    }

    private func rejection(_ row: LegacyObstacleRow) -> EventRejection? {
        if case .failure(let r) = EventDecoder.validate(row, expectedConvoy: convoy, now: now) { return r }
        return nil
    }
    private func rejection(_ row: HazardEventRow) -> EventRejection? {
        if case .failure(let r) = EventDecoder.validate(row, expectedConvoy: convoy, now: now) { return r }
        return nil
    }
}

final class RoadRelevanceTests: XCTestCase {
    func eval(_ h: HazardLocation?, _ f: ReceiverFix?) -> Relevance {
        RoadRelevance.evaluate(hazard: h, receiver: f, now: now)
    }

    func testInvalidAndFutureReceiverPositionIsHeld() {
        var receiver = fix()
        receiver.latitude = .nan
        XCTAssertEqual(eval(hazard(meters: 800, bearing: 0), receiver), .receiverUnknown("invalid position"))
        receiver = fix()
        receiver.timestamp = now + 60
        XCTAssertEqual(eval(hazard(meters: 800, bearing: 0), receiver), .receiverUnknown("invalid position"))
    }

    func testBeyondOneMileIsNotAhead() {
        XCTAssertEqual(eval(hazard(meters: 1700, bearing: 0), fix()), .notRelevant("far"))
    }

    func testNoHazardPositionIsUnlocated() {
        XCTAssertEqual(eval(nil, fix()), .unlocated)
    }

    func testSameHeadingInFrontIsAhead() {
        guard case .ahead(let d, false) = eval(hazard(meters: 800, bearing: 0), fix()) else { return XCTFail() }
        XCTAssertEqual(d, 800, accuracy: 2)
    }

    func testOppositeDirectionVehicleIsNotRelevant() {
        XCTAssertEqual(eval(hazard(meters: 800, bearing: 0, heading: 180), fix()), .notRelevant("opposite direction"))
    }

    func testAdjacentParallelRoadIsNotAhead() {
        // 120 m to the side, same heading: a parallel street, not our road.
        let p = TestEvents.offset(latitude: base.lat, longitude: base.lon, meters: 120, bearingDegrees: 90)
        let q = TestEvents.offset(latitude: p.0, longitude: p.1, meters: 400, bearingDegrees: 0)
        let h = HazardLocation(latitude: q.0, longitude: q.1, accuracyMeters: 10, headingDegrees: 0)
        let result = eval(h, fix())
        if case .ahead = result { XCTFail("parallel road must not be ahead: \(result)") }
    }

    func testCrossingRoadAtOverpassIsNotAhead() {
        // Hazard reported by a car heading east on a road crossing ours 300 m ahead.
        let result = eval(hazard(meters: 300, bearing: 0, heading: 90), fix())
        XCTAssertEqual(result, .nearbyDirectionUnverified(distanceMeters: result.distance ?? -1))
    }

    func testAlreadyPassedHazardIsSilent() {
        XCTAssertEqual(eval(hazard(meters: 300, bearing: 180), fix()), .notRelevant("behind or passed"))
    }

    func testStationaryReceiverNeverGetsAhead() {
        let result = eval(hazard(meters: 200, bearing: 0), fix(course: nil, speed: 0))
        guard case .nearbyDirectionUnverified = result else { return XCTFail("\(result)") }
        XCTAssertEqual(eval(hazard(meters: 2_000, bearing: 0), fix(course: nil, speed: 0)), .notRelevant("far while course unknown"))
    }

    func testStaleOrInaccurateReceiverIsUnknown() {
        XCTAssertEqual(eval(hazard(meters: 500, bearing: 0), fix(age: 60)), .receiverUnknown("stale position"))
        XCTAssertEqual(eval(hazard(meters: 500, bearing: 0), fix(accuracy: 200)), .receiverUnknown("low accuracy"))
        XCTAssertEqual(eval(hazard(meters: 500, bearing: 0), nil), .receiverUnknown("no position"))
    }

    func testMissingSenderHeadingOrInaccurateHazardIsNotAhead() {
        guard case .nearbyDirectionUnverified = eval(hazard(meters: 300, bearing: 0, heading: nil), fix()) else { return XCTFail() }
        guard case .nearbyDirectionUnverified = eval(hazard(meters: 300, bearing: 0, accuracy: 150), fix()) else { return XCTFail() }
    }

    func testFarAwayIsNotRelevant() {
        XCTAssertEqual(eval(hazard(meters: 10_000, bearing: 0), fix()), .notRelevant("far"))
    }
}

private extension Relevance {
    var distance: Double? {
        switch self {
        case .ahead(let d, _), .nearbyDirectionUnverified(let d): return d
        default: return nil
        }
    }
}

final class PhraseTests: XCTestCase {
    func event(_ source: HazardSource = .convoyMember, kind: HazardKind = .debris) -> HazardEvent {
        HazardEvent(id: UUID().uuidString, kind: kind, source: source, createdAt: now, expiresAt: now + 120)
    }

    func testOnlyAheadRelevanceSaysAhead() {
        let cases: [Relevance] = [.unlocated, .receiverUnknown("x"), .nearbyDirectionUnverified(distanceMeters: 200)]
        for relevance in cases {
            let text = AlertPhrases.phrase(for: event(), relevance: relevance, units: .imperial)!
            XCTAssertFalse(text.lowercased().contains("ahead"), text)
            XCTAssertFalse(text.contains("feet") || text.contains("mile"), text)
            XCTAssertTrue(text.contains("reported"), text)
        }
        let ahead = AlertPhrases.phrase(for: event(), relevance: .ahead(distanceMeters: 480, onRecordedRoad: true), units: .imperial)!
        XCTAssertEqual(ahead, "Heads up. Some debris, about a quarter mile ahead, reported by a convoy member.")
    }

    func testCameraReportWithSideAndDistance() {
        var e = event(.driverConfirmedCamera, kind: .object)
        e.side = .right
        XCTAssertEqual(AlertPhrases.phrase(for: e, relevance: .ahead(distanceMeters: 1_609, onRecordedRoad: true), units: .imperial),
                       "Heads up. Something on the right side of the road, about a mile ahead, reported by a Pudle driver.")
        XCTAssertEqual(AlertPhrases.phrase(for: e, relevance: .ahead(distanceMeters: 1_609, onRecordedRoad: true), units: .imperial, persona: .buddy)?
                        .hasPrefix("Yo, heads up."), true)
    }

    func testBlockageIsAlwaysPossibleAndSuggestsReroute() {
        var e = event(.driverConfirmedCamera, kind: .tree)
        e.blocksRoad = true
        let text = AlertPhrases.phrase(for: e, relevance: .ahead(distanceMeters: 800, onRecordedRoad: true), units: .imperial)!
        XCTAssertEqual(text, "Heads up. Possible road blockage about half a mile ahead: a fallen branch, reported by a Pudle driver. You might want to reroute.")
        let unverified = AlertPhrases.phrase(for: e, relevance: .nearbyDirectionUnverified(distanceMeters: 100), units: .imperial)!
        XCTAssertTrue(unverified.contains("possibly blocking"))
        XCTAssertFalse(unverified.contains("ahead"))
    }

    func testCameraPromptsAskForConfirmation() {
        let side = AlertPhrases.cameraPrompt(kind: .object, side: .right, blocksRoad: false, persona: .copilot)
        XCTAssertEqual(side, "Heads up. Possible object on the right side of the road coming up, in case you didn't notice. Want me to warn drivers behind you? Say report it, or cancel.")
        let block = AlertPhrases.cameraPrompt(kind: .tree, side: .center, blocksRoad: true, persona: .buddy)
        XCTAssertTrue(block.hasPrefix("Yo, heads up. Looks like a fallen branch might be blocking the road ahead."))
        XCTAssertTrue(AlertPhrases.cameraPrompt(kind: .animal, side: .left, blocksRoad: false, persona: .pro).contains("Possible animal on the left"))
    }

    func testVoiceIntent() {
        XCTAssertEqual(VoiceIntent.parse("report it but actually do not"), .cancel)
        XCTAssertEqual(VoiceIntent.parse("I am not sure please"), .cancel)
        XCTAssertEqual(VoiceIntent.parse("should I report it"), .unknown)
        XCTAssertEqual(VoiceIntent.parse("please"), .unknown)
        XCTAssertEqual(VoiceIntent.parse("Oh shoot, go ahead and report it"), .confirm)
        XCTAssertEqual(VoiceIntent.parse("Yeah"), .confirm)
        XCTAssertEqual(VoiceIntent.parse("yep do it"), .confirm)
        XCTAssertEqual(VoiceIntent.parse("No, don't report it"), .cancel)
        XCTAssertEqual(VoiceIntent.parse("cancel"), .cancel)
        XCTAssertEqual(VoiceIntent.parse("nah"), .cancel)
        XCTAssertEqual(VoiceIntent.parse("what was that"), .unknown)
        XCTAssertEqual(VoiceIntent.parse(""), .unknown)
    }

    func testUnlocatedConvoyReportCopy() {
        XCTAssertEqual(AlertPhrases.phrase(for: event(kind: .tree), relevance: .unlocated, units: .imperial),
                       "Pudle. Tree or branch in road, reported by a convoy member. Location not verified.")
    }

    func testTestEventsAreLabeled() {
        let text = AlertPhrases.phrase(for: event(.labeledTest), relevance: .unlocated, units: .metric)!
        XCTAssertTrue(text.hasPrefix("Pudle test alert."))
        XCTAssertTrue(text.contains("not a real report"))
    }

    func testNotRelevantHasNoPhrase() {
        XCTAssertNil(AlertPhrases.phrase(for: event(), relevance: .notRelevant("far"), units: .metric))
    }

    func testDistancesAreCoarse() {
        XCTAssertEqual(AlertPhrases.spokenDistance(40, units: .metric), "about 100 meters")
        XCTAssertEqual(AlertPhrases.spokenDistance(740, units: .metric), "about 700 meters")
        XCTAssertEqual(AlertPhrases.spokenDistance(2_300, units: .metric), "about 2.5 kilometers")
        XCTAssertEqual(AlertPhrases.spokenDistance(150, units: .imperial), "about 500 feet")
        XCTAssertEqual(AlertPhrases.spokenDistance(1_609, units: .imperial), "about a mile")
        XCTAssertEqual(AlertPhrases.spokenDistance(800, units: .imperial), "about half a mile")
    }
}

final class AlertPolicyTests: XCTestCase {
    func activePolicy() -> AlertPolicy {
        var p = AlertPolicy()
        p.isActive = true
        p.ownUserID = bob
        return p
    }
    func event(id: String = UUID().uuidString, kind: HazardKind = .debris, reporter: String = alice,
               created: TimeInterval = -2, location: HazardLocation? = nil) -> HazardEvent {
        HazardEvent(id: id, kind: kind, source: .convoyMember, reporterID: reporter,
                    createdAt: now + created, expiresAt: now + created + 120, location: location)
    }

    func testInactiveDriveNeverSpeaks() {
        var p = AlertPolicy()
        XCTAssertEqual(p.decide(event(), receiver: nil, now: now), .suppress(.driveNotActive))
    }

    func testDuplicateDeliveryIsSpokenOnce() {
        var p = activePolicy()
        let e = event()
        guard case .speak = p.decide(e, receiver: nil, now: now) else { return XCTFail() }
        XCTAssertEqual(p.decide(e, receiver: nil, now: now + 3), .suppress(.duplicate))
    }

    func testReorderedOlderEventStillGetsFreshnessCheck() {
        var p = activePolicy()
        _ = p.decide(event(kind: .tree), receiver: nil, now: now)
        XCTAssertEqual(p.decide(event(created: -200), receiver: nil, now: now), .suppress(.rejected(.expired)))
    }

    func testMutedEventsAreNotReplayedAfterUnmute() {
        var p = activePolicy()
        p.isMuted = true
        let e = event()
        XCTAssertEqual(p.decide(e, receiver: nil, now: now), .suppress(.muted))
        p.isMuted = false
        XCTAssertEqual(p.decide(e, receiver: nil, now: now + 1), .suppress(.duplicate))
    }

    func testOwnReportsAreNotReadBack() {
        var p = activePolicy()
        XCTAssertEqual(p.decide(event(reporter: bob), receiver: nil, now: now), .suppress(.ownReport))
    }

    func testSimilarUnlocatedReportIsCorroborationNotNewSpeech() {
        var p = activePolicy()
        guard case .speak = p.decide(event(), receiver: nil, now: now) else { return XCTFail() }
        XCTAssertEqual(p.decide(event(), receiver: nil, now: now + 10), .suppress(.similarRecentlyAnnounced))
        guard case .speak = p.decide(event(kind: .tree), receiver: nil, now: now + 11) else { return XCTFail() }
    }

    func testRateLimitBoundsSpeech() {
        var p = activePolicy()
        let kinds = HazardKind.allCases
        var spoken = 0
        for i in 0..<8 {
            let loc = hazard(meters: 300 + Double(i) * 400, bearing: 0)
            if case .speak = p.decide(event(kind: kinds[i % kinds.count], location: loc), receiver: fix(), now: now + Double(i)) {
                spoken += 1
            }
        }
        XCTAssertEqual(spoken, p.maxPerMinute)
    }

    func testFarReportIsSpokenWhenTheCarApproaches() {
        // Regression: a report first seen too far away used to be consumed and never spoken.
        var p = activePolicy()
        let e = event(location: hazard(meters: 2_600, bearing: 0))
        XCTAssertEqual(p.decide(e, receiver: fix(), now: now), .suppress(.notRelevantYet("far")))
        let closer = TestEvents.offset(latitude: base.lat, longitude: base.lon, meters: 1_200, bearingDegrees: 0)
        var later = fix()
        later.latitude = closer.0; later.longitude = closer.1; later.timestamp = now + 30
        guard case .speak(_, .ahead(let d, _)) = p.decide(e, receiver: later, now: now + 30) else { return XCTFail() }
        XCTAssertEqual(d, 1_400, accuracy: 5)
        XCTAssertEqual(p.decide(e, receiver: later, now: now + 32), .suppress(.duplicate))
    }

    func testRateLimitedEventIsNotLost() {
        var p = activePolicy()
        p.maxPerMinute = 1
        guard case .speak = p.decide(event(kind: .tree), receiver: nil, now: now) else { return XCTFail() }
        let e = event(kind: .animal)
        XCTAssertEqual(p.decide(e, receiver: nil, now: now + 1), .suppress(.rateLimited))
        guard case .speak = p.decide(e, receiver: nil, now: now + 61) else { return XCTFail() }
    }

    func testIrrelevantLocatedEventIsSilent() {
        var p = activePolicy()
        let decision = p.decide(event(location: hazard(meters: 400, bearing: 0, heading: 180)), receiver: fix(), now: now)
        XCTAssertEqual(decision, .suppress(.notRelevantYet("opposite direction")))
    }

    func testResetForgetsHistory() {
        var p = activePolicy()
        let e = event()
        _ = p.decide(e, receiver: nil, now: now)
        p.reset()
        XCTAssertEqual(p.consumedCount, 0)
    }
}

final class StatusTests: XCTestCase {
    func snapshot(feed: FeedState, background: Bool = true, muted: Bool = false, phase: DrivePhase = .active) -> DriveSnapshot {
        DriveSnapshot(phase: phase, muted: muted, location: .whenInUse, backgroundLocationRunning: background,
                      notificationsAllowed: true, feed: feed)
    }

    func testOfflineIsNeverAllClear() {
        let line = DriveStatusText.headline(snapshot(feed: .offline))
        XCTAssertEqual(line.tone, .problem)
        XCTAssertTrue(line.detail.contains("not an all-clear"))
    }

    func testNoBackgroundLocationSaysPudleMustStayOpen() {
        XCTAssertTrue(DriveStatusText.headline(snapshot(feed: .live(lastSuccess: now), background: false)).title.contains("stay open"))
    }

    func testStoppedSaysNoCollection() {
        XCTAssertTrue(DriveStatusText.headline(snapshot(feed: .offline, phase: .stopped)).detail.contains("not collecting location"))
    }

    func testPercentile() {
        XCTAssertNil(LatencyStats.percentile([], 50))
        XCTAssertEqual(LatencyStats.percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50), 5)
        XCTAssertEqual(LatencyStats.percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95), 10)
    }
}

final class CorridorTests: XCTestCase {
    /// A road recorded heading north from `base` for 3 km, with a bend east after 1.5 km.
    func road() -> RoadCorridor {
        var points: [RoadCorridor.Point] = []
        var lat = base.lat, lon = base.lon
        points.append(.init(lat, lon))
        for _ in 0..<30 {   // 1.5 km north in 50 m steps
            (lat, lon) = TestEvents.offset(latitude: lat, longitude: lon, meters: 50, bearingDegrees: 0)
            points.append(.init(lat, lon))
        }
        for _ in 0..<30 {   // then 1.5 km north-east
            (lat, lon) = TestEvents.offset(latitude: lat, longitude: lon, meters: 50, bearingDegrees: 45)
            points.append(.init(lat, lon))
        }
        return RoadCorridor(id: "c", name: "Demo road", points: points)!
    }

    func along(_ meters: Double) -> (Double, Double) {
        let c = road()
        // Walk the polyline to the requested distance.
        var remaining = meters
        for i in 0..<(c.points.count - 1) {
            let a = c.points[i], b = c.points[i + 1]
            let d = Geo.distance(lat1: a.latitude, lon1: a.longitude, lat2: b.latitude, lon2: b.longitude)
            if remaining <= d {
                let bearing = Geo.bearing(lat1: a.latitude, lon1: a.longitude, lat2: b.latitude, lon2: b.longitude)
                return TestEvents.offset(latitude: a.latitude, longitude: a.longitude, meters: remaining, bearingDegrees: bearing)
            }
            remaining -= d
        }
        return (c.points.last!.latitude, c.points.last!.longitude)
    }

    func receiver(at meters: Double, course: Double?, speed: Double = 8, sideways: Double = 0) -> ReceiverFix {
        var p = along(meters)
        if sideways != 0 { p = TestEvents.offset(latitude: p.0, longitude: p.1, meters: abs(sideways), bearingDegrees: sideways > 0 ? 90 : 270) }
        return ReceiverFix(latitude: p.0, longitude: p.1, accuracyMeters: 8, courseDegrees: course, speedMetersPerSecond: speed,
                           timestamp: now - 1)
    }

    func hazardAt(_ meters: Double, sideways: Double = 6) -> HazardLocation {
        let p = along(meters)
        let q = TestEvents.offset(latitude: p.0, longitude: p.1, meters: sideways, bearingDegrees: 90)
        return HazardLocation(latitude: q.0, longitude: q.1, accuracyMeters: 10, headingDegrees: 0)
    }

    func eval(_ h: HazardLocation, _ r: ReceiverFix) -> Relevance {
        RoadRelevance.evaluate(hazard: h, receiver: r, now: now, corridor: road())
    }

    func testAheadAroundTheBendUsesRoadDistance() {
        // Receiver at 1.0 km, hazard at 2.4 km (past the bend): straight-line bearing is off,
        // but along the road it is 1.4 km ahead in our direction.
        guard case .ahead(let d, true) = eval(hazardAt(2_400), receiver(at: 1_000, course: 0)) else { return XCTFail() }
        XCTAssertEqual(d, 1_400, accuracy: 15)
    }

    func testOneMileWindow() {
        XCTAssertEqual(eval(hazardAt(2_900), receiver(at: 500, course: 0)), .notRelevant("not yet in range"))
        guard case .ahead = eval(hazardAt(2_000), receiver(at: 500, course: 0)) else { return XCTFail() }
    }

    func testOppositeReporterOnRecordedRoadIsSuppressed() {
        var report = hazardAt(1_200)
        report.headingDegrees = 180
        XCTAssertEqual(eval(report, receiver(at: 600, course: 0)), .notRelevant("report direction differs from road"))
    }

    func testOppositeDirectionOnSameRoad() {
        XCTAssertEqual(eval(hazardAt(1_200), receiver(at: 600, course: 180)), .notRelevant("opposite direction"))
    }

    func testAlreadyPassed() {
        XCTAssertEqual(eval(hazardAt(400), receiver(at: 900, course: 0)), .notRelevant("behind or passed"))
    }

    func testParallelStreetIsNotWarned() {
        let result = eval(hazardAt(1_200), receiver(at: 800, course: 0, sideways: 150))
        XCTAssertEqual(result, .notRelevant("off the recorded road"))
    }

    func testSlowDrivingStillGetsAheadWhenCourseIsKnown() {
        guard case .ahead = eval(hazardAt(1_000), receiver(at: 600, course: 0, speed: 1.5)) else { return XCTFail() }
    }

    func testCourseEstimatorFromSlowFixes() {
        let fixes = (0..<6).map { i -> ReceiverFix in
            let p = TestEvents.offset(latitude: base.lat, longitude: base.lon, meters: Double(i) * 4, bearingDegrees: 30)
            return ReceiverFix(latitude: p.0, longitude: p.1, accuracyMeters: 6, courseDegrees: nil, speedMetersPerSecond: 1,
                               timestamp: now + Double(i) * 2)
        }
        XCTAssertEqual(CourseEstimator.course(from: fixes)!, 30, accuracy: 1)
        XCTAssertNil(CourseEstimator.course(from: Array(fixes.prefix(2))))
    }
}

final class DetectionFilterTests: XCTestCase {
    typealias O = DetectionFilter.Observation

    func testTwoAgreeingFramesTriggerOncePerCooldown() {
        var f = DetectionFilter()
        XCTAssertNil(f.add(O(kind: .tree, side: .right, blocksRoad: false, confidence: 0.7, at: now), now: now))
        let hit = f.add(O(kind: .debris, side: .right, blocksRoad: true, confidence: 0.75, at: now + 1), now: now + 1)
        XCTAssertEqual(hit?.kind, .debris)
        XCTAssertEqual(hit?.blocksRoad, true)
        XCTAssertNil(f.add(O(kind: .tree, side: .right, blocksRoad: false, confidence: 0.95, at: now + 5), now: now + 5))
        XCTAssertNotNil(f.add(O(kind: .tree, side: .left, blocksRoad: false, confidence: 0.95, at: now + 40), now: now + 40))
    }

    func testLowConfidenceAndStaleFramesAreIgnored() {
        var f = DetectionFilter()
        XCTAssertNil(f.add(O(kind: .tree, side: .right, blocksRoad: false, confidence: 0.3, at: now), now: now))
        XCTAssertNil(f.add(O(kind: .tree, side: .right, blocksRoad: false, confidence: 0.6, at: now), now: now))
        XCTAssertNil(f.add(nil, now: now + 3))
        XCTAssertNil(f.add(O(kind: .tree, side: .right, blocksRoad: false, confidence: 0.6, at: now + 9), now: now + 9))
    }

    func testSingleVeryConfidentFrame() {
        var f = DetectionFilter()
        XCTAssertEqual(f.add(O(kind: .animal, side: .center, blocksRoad: false, confidence: 0.9, at: now), now: now)?.kind, .animal)
    }
}

final class CompanionCommandTests: XCTestCase {
    func testSceneRequests() {
        XCTAssertEqual(CompanionCommand.parse("Hey Pudle, what do you see?"), .describe)
        XCTAssertEqual(CompanionCommand.parse("What's in front of me?"), .describe)
        XCTAssertEqual(CompanionCommand.parse("Describe the scene"), .describe)
    }
    func testReportRequiresAffirmation() {
        XCTAssertEqual(CompanionCommand.parse("Go ahead and report it"), .report)
        XCTAssertEqual(CompanionCommand.parse("Should I report it?"), .unknown)
        XCTAssertEqual(CompanionCommand.parse("Don't report it"), .cancel)
        XCTAssertEqual(CompanionCommand.parse("cancel"), .cancel)
    }
}
