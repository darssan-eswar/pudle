'use client';

import { useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { listReports } from './convoys';
import { alertCopy, isFreshReport, parseReport, type ObstacleReport } from './obstacles';

export type FeedStatus = 'connecting' | 'live' | 'reconnecting';

export function useObstacleFeed(client: SupabaseClient | null, convoyId: string | null, userId: string | null, audioEnabled: boolean) {
  const [reports, setReports] = useState<ObstacleReport[]>([]);
  const [latestAlert, setLatestAlert] = useState<ObstacleReport | null>(null);
  const [status, setStatus] = useState<FeedStatus>('connecting');
  const [error, setError] = useState('');
  const seen = useRef(new Set<string>());
  const audioRef = useRef(audioEnabled);

  useEffect(() => { audioRef.current = audioEnabled; }, [audioEnabled]);

  useEffect(() => {
    let disposed = false;
    seen.current.clear();
    queueMicrotask(() => {
      if (disposed) return;
      setReports([]);
      setLatestAlert(null);
      setStatus('connecting');
      setError('');
    });
    if (!client || !convoyId || !userId) return () => { disposed = true; };

    function receive(raw: unknown) {
      if (disposed) return;
      const report = parseReport(raw);
      if (!report || report.convoy_id !== convoyId || !isFreshReport(report)) return;
      if (seen.current.has(report.id)) return;
      seen.current.add(report.id);
      setReports((current) => [report, ...current.filter((item) => item.id !== report.id && isFreshReport(item))]
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
        .slice(0, 25));
      if (report.reporter_id === userId) return;
      setLatestAlert(report);
      if (audioRef.current && document.visibilityState === 'visible' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(alertCopy(report.kind));
        utterance.lang = 'en-US';
        utterance.rate = 0.96;
        window.speechSynthesis.speak(utterance);
      }
    }

    async function refresh() {
      try {
        const recent = await listReports(client!, convoyId!);
        if (disposed) return;
        recent.slice().reverse().forEach(receive);
        setReports((current) => current.filter((item) => isFreshReport(item)));
        setLatestAlert((current) => current && isFreshReport(current) ? current : null);
        setError('');
      } catch {
        if (!disposed) setError('Could not refresh reports. Check the connection.');
      }
    }

    const channel = client.channel(`obstacles:${convoyId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'obstacle_reports',
        filter: `convoy_id=eq.${convoyId}`,
      }, (payload) => receive(payload.new))
      .subscribe((state) => {
        if (disposed) return;
        setStatus(state === 'SUBSCRIBED' ? 'live' : 'reconnecting');
        if (state === 'SUBSCRIBED') void refresh();
      });
    void refresh();
    const interval = window.setInterval(() => void refresh(), 3_000);

    return () => {
      disposed = true;
      window.clearInterval(interval);
      void client.removeChannel(channel);
      window.speechSynthesis?.cancel();
    };
  }, [client, convoyId, userId]);

  return { reports, latestAlert, status, error };
}
