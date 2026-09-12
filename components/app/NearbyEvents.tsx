'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PudleButton, PudleStatusBadge } from '@/components/pudle';
import {
  createEventIdempotencyKey,
  createEventsApi,
  DISTANCE_LABELS,
  EVENT_LABELS,
  EVENT_TYPES,
  NearbyPollController,
  type EventCoordinates,
  type EventsApi,
  type EventType,
  type NearbyEvent,
} from '@/lib/client/app';

type LocationState =
  | { status: 'unsupported' | 'idle' | 'requesting' | 'denied' | 'unavailable'; coordinates: null; message: string }
  | { status: 'granted'; coordinates: EventCoordinates; message: string };

export interface NearbyEventsProps {
  active: boolean;
  online: boolean;
  reconnecting?: boolean;
  currentUserId: string;
  preparedByPudy: boolean;
  onPreparedHandled: () => void;
  onNearbyLabelsChange: (labels: string[]) => void;
  api?: EventsApi;
  pollIntervalMs?: number;
}

function initialLocation(): LocationState {
  return typeof navigator === 'undefined' || !navigator.geolocation
    ? { status: 'unsupported', coordinates: null, message: 'Location is not supported in this browser.' }
    : { status: 'idle', coordinates: null, message: 'Location stays off until you choose to share it.' };
}

function isAbort(error: unknown) {
  return error instanceof Error && error.name === 'AbortError';
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'The request could not be completed.';
}

function locationError(error: GeolocationPositionError): LocationState {
  if (error.code === error.PERMISSION_DENIED) {
    return {
      status: 'denied',
      coordinates: null,
      message: 'Location access is blocked. Allow approximate location in browser settings, then try again.',
    };
  }
  return {
    status: 'unavailable',
    coordinates: null,
    message: 'Your location is unavailable. Move to an open area or check device location settings.',
  };
}

export function NearbyEvents({
  active,
  online,
  reconnecting = false,
  currentUserId,
  preparedByPudy,
  onPreparedHandled,
  onNearbyLabelsChange,
  api: suppliedApi,
  pollIntervalMs = 5_000,
}: NearbyEventsProps) {
  const api = useMemo(() => suppliedApi ?? createEventsApi(), [suppliedApi]);
  const [location, setLocation] = useState<LocationState>(initialLocation);
  const [events, setEvents] = useState<NearbyEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [pollError, setPollError] = useState('');
  const [reportType, setReportType] = useState<EventType>('road-hazard');
  const [reviewing, setReviewing] = useState(false);
  const [mutation, setMutation] = useState<{ action: 'create' | 'ack' | 'resolve'; eventId?: string; key: string } | null>(null);
  const [mutationError, setMutationError] = useState('');
  const [ownedIds, setOwnedIds] = useState<Set<string>>(() => new Set());
  const [acknowledgedIds, setAcknowledgedIds] = useState<Set<string>>(() => new Set());
  const mutationController = useRef<AbortController | undefined>(undefined);
  const pollRef = useRef<NearbyPollController | undefined>(undefined);

  const publishLabels = useCallback((next: NearbyEvent[]) => {
    onNearbyLabelsChange(next.map((event) =>
      `${EVENT_LABELS[event.type]} · ${DISTANCE_LABELS[event.distanceBand]}`,
    ));
  }, [onNearbyLabelsChange]);

  useEffect(() => {
    publishLabels([]);
    mutationController.current?.abort();
    queueMicrotask(() => {
      setEvents([]);
      setOwnedIds(new Set());
      setAcknowledgedIds(new Set());
      setMutation(null);
      setMutationError('');
    });
  }, [currentUserId, publishLabels]);

  useEffect(() => {
    pollRef.current?.stop();
    pollRef.current = undefined;
    if (!active || !online || location.status !== 'granted') {
      return;
    }
    const coordinates = location.coordinates;
    queueMicrotask(() => setLoading(true));
    const poller = new NearbyPollController(async (signal) => {
      try {
        const next = await api.nearby(coordinates, signal);
        setEvents(next);
        publishLabels(next);
        setPollError('');
      } catch (error) {
        if (!isAbort(error)) {
          setEvents([]);
          publishLabels([]);
          setPollError(errorText(error));
        }
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    }, pollIntervalMs);
    pollRef.current = poller;
    poller.start();
    return () => poller.stop();
  }, [active, api, currentUserId, location, online, pollIntervalMs, publishLabels]);

  useEffect(() => () => {
    mutationController.current?.abort();
    pollRef.current?.stop();
    publishLabels([]);
  }, [publishLabels]);

  useEffect(() => {
    if (!active || !online || location.status !== 'granted') {
      mutationController.current?.abort();
    }
  }, [active, currentUserId, location, online]);

  function requestLocation() {
    if (!navigator.geolocation) {
      setLocation(initialLocation());
      return;
    }
    setLocation({ status: 'requesting', coordinates: null, message: 'Waiting for your browser…' });
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => setLocation({
        status: 'granted',
        coordinates: { latitude: coords.latitude, longitude: coords.longitude },
        message: 'Approximate location is on. Coordinates are rounded before sharing.',
      }),
      (error) => setLocation(locationError(error)),
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 10_000 },
    );
  }

  function disableLocation() {
    pollRef.current?.stop();
    mutationController.current?.abort();
    setLocation({
      status: 'idle',
      coordinates: null,
      message: 'Location is off. Nearby updates are paused.',
    });
    setEvents([]);
    publishLabels([]);
  }

  const runMutation = useCallback(async (pending: NonNullable<typeof mutation>) => {
    if (location.status !== 'granted' || !online) return;
    mutationController.current?.abort();
    const controller = new AbortController();
    mutationController.current = controller;
    setMutation(pending);
    setMutationError('');
    try {
      if (pending.action === 'create') {
        const created = await api.create({
          type: reportType,
          ...location.coordinates,
        }, pending.key, controller.signal);
        setOwnedIds((current) => new Set(current).add(created.id));
        setReviewing(false);
        onPreparedHandled();
      } else if (pending.action === 'ack' && pending.eventId) {
        await api.acknowledge(pending.eventId, pending.key, controller.signal);
        setAcknowledgedIds((current) => new Set(current).add(pending.eventId!));
      } else if (pending.action === 'resolve' && pending.eventId) {
        await api.resolve(pending.eventId, pending.key, controller.signal);
        setEvents((current) => {
          const next = current.filter(({ id }) => id !== pending.eventId);
          publishLabels(next);
          return next;
        });
      }
      pollRef.current?.retry();
      setMutation(null);
    } catch (error) {
      if (!isAbort(error)) setMutationError(errorText(error));
    } finally {
      if (mutationController.current === controller) mutationController.current = undefined;
    }
  }, [api, location, onPreparedHandled, online, publishLabels, reportType]);

  function beginMutation(action: 'create' | 'ack' | 'resolve', eventId?: string) {
    void runMutation({ action, eventId, key: createEventIdempotencyKey(action) });
  }

  const retryMutation = () => {
    if (mutation) void runMutation(mutation);
  };
  const reviewOpen = reviewing || preparedByPudy;

  return (
    <section className="pudle-card pudle-nearby" aria-labelledby="nearby-title">
      <header className="pudle-panel-header">
        <div>
          <p className="pudle-eyebrow">Nearby reports</p>
          <h2 id="nearby-title">What drivers observed</h2>
        </div>
        <PudleStatusBadge tone={location.status === 'granted' ? 'positive' : location.status === 'denied' ? 'danger' : 'neutral'}>
          {location.status === 'granted' ? 'Location on' : location.status}
        </PudleStatusBadge>
      </header>

      <p className="pudle-location-copy" role="status">{location.message}</p>
      {location.status === 'idle' || location.status === 'denied' || location.status === 'unavailable' ? (
        <>
          <p>To load reports within 2 miles, Pudle needs your approximate position. It is requested only after this tap and rounded before every request.</p>
          <PudleButton onClick={requestLocation}>
            {location.status === 'denied' ? 'Try location again' : 'Share approximate location'}
          </PudleButton>
        </>
      ) : null}
      {location.status === 'requesting' ? <p role="status">Requesting location permission…</p> : null}
      {location.status === 'unsupported' ? <p>Use a browser with geolocation support. Manual reports need a location and are unavailable here.</p> : null}

      {location.status === 'granted' ? (
        <>
          <div className="pudle-nearby-actions">
            <PudleButton onClick={() => setReviewing(true)} disabled={!online}>Prepare a road report</PudleButton>
            <PudleButton variant="quiet" onClick={disableLocation}>Turn location off</PudleButton>
          </div>

          {reviewOpen ? (
            <div className="pudle-report-review" aria-labelledby="report-review-title">
              <h3 id="report-review-title">Review report</h3>
              <p>Nothing is shared until you confirm. Choose only what you directly observed.</p>
              <label className="pudle-field">
                <span>Observed road condition</span>
                <select value={reportType} onChange={(event) => setReportType(event.target.value as EventType)}>
                  {EVENT_TYPES.map((type) => <option key={type} value={type}>{EVENT_LABELS[type]}</option>)}
                </select>
              </label>
              <div className="pudle-review-actions">
                <PudleButton
                  onClick={() => beginMutation('create')}
                  disabled={!online || mutation?.action === 'create'}
                >
                  {mutation?.action === 'create' ? 'Sharing…' : 'Confirm and share'}
                </PudleButton>
                <PudleButton variant="quiet" onClick={() => { setReviewing(false); onPreparedHandled(); }}>
                  Cancel
                </PudleButton>
              </div>
            </div>
          ) : null}

          {!online ? <p role="status">{reconnecting
            ? 'Connection restored. Reconnecting nearby reports…'
            : 'Offline. Nearby reports are paused and will reconnect automatically.'}</p>
            : loading ? <p role="status">Loading nearby reports…</p>
              : pollError ? (
                <div role="alert">
                  <p>Nearby reports could not refresh: {pollError}</p>
                  <PudleButton variant="secondary" onClick={() => pollRef.current?.retry()}>Retry nearby reports</PudleButton>
                </div>
              ) : events.length === 0 ? <p className="pudle-empty-copy">No current reports nearby. The server checks the 2-mile, 30-minute window.</p>
                : (
                  <ul className="pudle-event-list">
                    {events.map((event) => {
                      const owned = ownedIds.has(event.id);
                      const acknowledged = acknowledgedIds.has(event.id);
                      return (
                        <li className="pudle-event-card" key={event.id}>
                          <div className="pudle-event-card__topline">
                            <h3>{EVENT_LABELS[event.type]}</h3>
                            <span>{DISTANCE_LABELS[event.distanceBand]}</span>
                          </div>
                          <p>{event.direction ? `Direction ${event.direction} · ` : ''}Reported recently</p>
                          <div className="pudle-event-controls">
                            <PudleButton
                              variant="secondary"
                              disabled={acknowledged || mutation?.eventId === event.id}
                              onClick={() => beginMutation('ack', event.id)}
                            >
                              {acknowledged ? 'Acknowledged' : 'Acknowledge'}
                            </PudleButton>
                            {owned ? (
                              <PudleButton
                                variant="quiet"
                                disabled={mutation?.eventId === event.id}
                                onClick={() => beginMutation('resolve', event.id)}
                              >
                                Resolve my report
                              </PudleButton>
                            ) : null}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
        </>
      ) : null}

      {mutationError ? (
        <div className="pudle-mutation-error" role="alert">
          <p>{mutationError}</p>
          <PudleButton variant="secondary" onClick={retryMutation}>Retry same request</PudleButton>
        </div>
      ) : null}
    </section>
  );
}
