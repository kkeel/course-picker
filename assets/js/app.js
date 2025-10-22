function courseApp(){
  return {
    /* ---------- UI state ---------- */
    search: '',
    filters: { subject: '', levelTag: '' },
    courses: [],
    courseIndex: {},

    /* ---------- Data sources (Google Sheets CSVs) ---------- */
    dataSources: {
      courses: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQsihZUzspkkv62sv-KxQOjiXIApm8W8fOO1f_y9sfhyLLTeJhGsq6l5k1BhONtEtw7q197VqdZqDN3/pub?gid=0&single=true&output=csv',
      topics:  'https://docs.google.com/spreadsheets/d/e/2PACX-1vQsihZUzspkkv62sv-KxQOjiXIApm8W8fOO1f_y9sfhyLLTeJhGsq6l5k1BhONtEtw7q197VqdZqDN3/pub?gid=1919021076&single=true&output=csv'
    },

    /* ---------- CSV field maps (match your headers) ---------- */
    courseFields: {
      course_id: 'Course_ID',
      course_title: 'Course',
      subject: 'Subject',
      schedule_text: 'Scheduling_R3',
      grade_text: 'Grade_Text',
      grade_filter: 'Grade_Filter',
      description: 'Program_Description_R3',
      combining_placement: 'Combining&PlacementTips_R3'
    },
    topicFields: {
      topic_id: 'Topic_ID',
      course_id: 'Course_ID_R3',              // comma-separated list
      topic_title: 'Topic',
      topic_description: 'Program_Description_R3',
      combining_placement: 'Combining&PlacementTips_R3',
      schedule_text: 'Scheduling_R3',
      grade_text: 'Grade_Text',
      grade_filter: 'Grade_Filter'
    },

    /* ---------- Derived lists ---------- */
    get selected(){ return this.courses.filter(c => c.checked); },
    get selectedCount(){
      return this.courses.reduce((n,c)=> n + (c.checked?1:0) + ((c.topics||[]).filter(t=>t.checked).length), 0);
    },

    get filtered(){
      const q = this.search.toLowerCase();
      return this.courses.filter(c=>{
        const matchesQ = !q || [c.title, c.subject, c.summary, c.levelDisplay].join(' ').toLowerCase().includes(q);
        const matchesS = !this.filters.subject || c.subject === this.filters.subject;
        const matchesL = !this.filters.levelTag || (c.levelTags && c.levelTags.includes(this.filters.levelTag));
        return matchesQ && matchesS && matchesL;
      });
    },

    get subjectList(){
      const arr = [...new Set(this.courses.map(c => c.subject).filter(Boolean))];
      arr.sort((a,b)=>{
        if(a==='Alt. Science Options') return 1;
        if(b==='Alt. Science Options') return -1;
        return a.localeCompare(b, undefined, {numeric:true});
      });
      return arr;
    },

    get levelList(){
      return [...new Set(this.courses.flatMap(c => c.levelTags || []))]
        .sort((a,b)=>{
          const na = +a.replace(/\D/g,''); const nb = +b.replace(/\D/g,'');
          return na-nb || a.localeCompare(b);
        });
    },

    // Group by subject; ensure Alt. Science Options is last
    get grouped(){
      const groups = new Map();
      this.filtered.forEach(c => {
        const s = c.subject || 'Other';
        if (!groups.has(s)) groups.set(s, []);
        groups.get(s).push(c);
      });
      const special = 'Alt. Science Options';
      return Array.from(groups.entries()).sort((a,b)=>{
        const A=a[0]||'', B=b[0]||'';
        if (A===special && B!==special) return 1;
        if (B===special && A!==special) return -1;
        return A.localeCompare(B, undefined, {numeric:true});
      });
    },

    /* ---------- Helpers ---------- */
    _getCI(row, want){
      const keys = Array.isArray(want) ? want : [want];
      for(const k of keys){
        const hit = Object.keys(row).find(h => h.trim().toLowerCase() === String(k).trim().toLowerCase());
        if(hit) return row[hit];
      }
      return undefined;
    },
    computeGradeTags(gr){
      const tags=[];
      const range  = gr && gr.match(/^(?:[Gg]?(\d+))\s*[–-]\s*[Gg]?(\d+)$/);
      if(range){ const a=+range[1], b=+range[2]; for(let i=Math.min(a,b); i<=Math.max(a,b); i++) tags.push(`G${i}`); return tags; }
      const single = gr && gr.match(/^[Gg]?(\d+)$/);
      if(single){ return [`G${+single[1]}`]; }
      if(gr && String(gr).includes(',')){
        String(gr).split(',').forEach(x=>{ const n=x.replace(/[^0-9]/g,''); if(n) tags.push(`G${+n}`); });
      }
      return tags;
    },

    rowToCourse(row){
      if(!row) return null;
      const g = (k) => this._getCI(row, this.courseFields[k]);

      const id    = (g('course_id')    || '').toString().trim();
      const title = (g('course_title') || '').toString().trim();
      if(!id && !title) return null;

      const subject    = (g('subject') || '').toString().trim();
      const gradeText  = (g('grade_text')   || '').toString().trim();
      const gradeFilter= (g('grade_filter') || '').toString().trim();
      const schedule   = (g('schedule_text')|| '').toString().trim();
      const description= (g('description')  || '').toString().trim();
      const combining  = (g('combining_placement') || '').toString().trim();

      const levelDisplay = gradeText || '';
      const levelTags = (gradeFilter && /G\s*\d+/i.test(gradeFilter))
        ? (gradeFilter.match(/G\s*\d+/gi) || []).map(s => 'G' + s.replace(/[^0-9]/g,''))
        : this.computeGradeTags(gradeText);

      const details = [];
      if(description) details.push({ label:'Description', value: description });
      if(combining)   details.push({ label:'Combining & Placement', value: combining });

      return { id: id||title, title: title||id, subject, summary: schedule, details, levelDisplay, levelTags, checked: false };
    },

    rowToTopic(row){
      if(!row) return null;
      const g = (k) => this._getCI(row, this.topicFields[k]);

      const rawCourseIds = (g('course_id') || '').toString().trim();
      const topic_title  = (g('topic_title')|| '').toString().trim();
      if(!rawCourseIds || !topic_title) return null;

      const topic_id     = (g('topic_id') || '').toString().trim() || (rawCourseIds + '::' + topic_title);
      const topic_desc   = (g('topic_description') || '').toString().trim();
      const combining    = (g('combining_placement') || '').toString().trim();
      const schedule_t   = (g('schedule_text') || '').toString().trim();
      const gradeText    = (g('grade_text') || '').toString().trim();
      const gradeFilter  = (g('grade_filter') || '').toString().trim();

      const levelDisplay = gradeText || '';
      const levelTags = (gradeFilter && /G\s*\d+/i.test(gradeFilter))
        ? (gradeFilter.match(/G\s*\d+/gi) || []).map(s => 'G' + s.replace(/[^0-9]/g,''))
        : this.computeGradeTags(gradeText);

      const details = [];
      if(topic_desc) details.push({ label:'Description', value: topic_desc });
      if(combining)  details.push({ label:'Combining & Placement', value: combining });

      return {
        topic_id,
        course_ids: rawCourseIds.split(',').map(s=>s.trim()).filter(Boolean),
        topic_title,
        summary: schedule_t,
        details,
        levelDisplay,
        levelTags,
        checked: false
      };
    },

    async loadDualCSVs(){
      const cacheKey = 'pf_csv_cache_v1';
      const maxAgeMs = 6 * 60 * 60 * 1000; // 6 hours
      const now = Date.now();

      // Try cache
      let cached;
      try { cached = JSON.parse(localStorage.getItem(cacheKey) || 'null'); } catch {}
      if (cached && (now - cached.ts) < maxAgeMs) {
        const pc = Papa.parse(cached.courses, { header:true, skipEmptyLines:true });
        const pt = Papa.parse(cached.topics,  { header:true, skipEmptyLines:true });
        this.applyParsed(pc, pt);
        return;
      }

      // Fetch fresh
      const [coursesCSV, topicsCSV] = await Promise.all([
        fetch(this.dataSources.courses, { mode:'cors' }).then(r=>r.text()),
        fetch(this.dataSources.topics,  { mode:'cors' }).then(r=>r.text())
      ]);

      // Save to cache
      localStorage.setItem(cacheKey, JSON.stringify({ ts: now, courses: coursesCSV, topics: topicsCSV }));

      const pc = Papa.parse(coursesCSV, { header:true, skipEmptyLines:true });
      const pt = Papa.parse(topicsCSV,  { header:true, skipEmptyLines:true });
      this.applyParsed(pc, pt);
    },

    applyParsed(pc, pt){
      this.courseIndex = {};
      pc.data.forEach(row => {
        const c = this.rowToCourse(row);
        if(c) this.courseIndex[c.id] = { ...c, topics: [] };
      });

      pt.data.forEach(row => {
        const t = this.rowToTopic(row);
        if(!t) return;
        t.course_ids.forEach(cid => {
          if(this.courseIndex[cid]) this.courseIndex[cid].topics.push(t);
        });
      });

      this.courses = Object.values(this.courseIndex);
    },

    /* ---------- Persist course + topic selection ---------- */
    persist(){
      const ids = [];
      this.courses.forEach(c=>{
        if(c.checked) ids.push('c:'+c.id);
        (c.topics||[]).forEach(t=>{ if(t.checked) ids.push('t:'+t.topic_id); });
      });
      localStorage.setItem('pf_courses', JSON.stringify(ids));
    },
    restoreChecked(){
      try{
        const saved = JSON.parse(localStorage.getItem('pf_courses') || '[]');
        const set = new Set(saved);
        this.courses.forEach(c=>{
          c.checked = set.has('c:'+c.id);
          (c.topics||[]).forEach(t => { t.checked = set.has('t:'+t.topic_id); });
        });
      }catch{}
    },

    printSelected(){ window.print(); },

    async init(){
      await this.loadDualCSVs();
      this.restoreChecked();
    }
  };
}
