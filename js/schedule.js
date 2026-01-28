// js/schedule.js
// Schedule page local state (V1 scaffolding)

(function () {
  // Alpine component for schedule page
  window.scheduleBuilder = function scheduleBuilder() {
    return {
      view: "track", // 'track' (v1) or 'day' (later)

      // V1 "students" = Tracks (no student data yet)
      tracks: [
        { id: "T1", name: "Track 1" },
        { id: "T2", name: "Track 2" },
        { id: "T3", name: "Track 3" },
        { id: "T4", name: "Track 4" },
        { id: "T5", name: "Track 5" }
      ],

      // The visible panel slots (key to A + D comparisons)
      visibleTrackPanels: [
        { slot: "P1", trackId: "T1", pinned: false, collapsed: false },
        { slot: "P2", trackId: "T2", pinned: false, collapsed: false }
      ],

      trackLabel(trackId) {
        const t = this.tracks.find(x => x.id === trackId);
        return t ? t.name : "Track";
      }
    };
  };
})();
