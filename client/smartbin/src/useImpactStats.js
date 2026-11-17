import { useEffect, useState } from 'react';
import api from './api';

// Live, platform-wide impact numbers for the public pages (landing, about).
// One request per page load is shared by every component that uses the hook.
let statsPromise = null;

function fetchStats() {
  if (!statsPromise) {
    statsPromise = api.get('/api/stats')
      .then((res) => res.data)
      .catch((err) => { statsPromise = null; throw err; });
  }
  return statsPromise;
}

export default function useImpactStats() {
  const [state, setState] = useState({ status: 'loading', stats: null });

  useEffect(() => {
    let active = true;
    fetchStats()
      .then((stats) => { if (active) setState({ status: 'ready', stats }); })
      .catch(() => { if (active) setState({ status: 'error', stats: null }); });
    return () => { active = false; };
  }, []);

  return state;
}
