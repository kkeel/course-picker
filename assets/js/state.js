export const state = {
rotation: null,
search: "",
selectedCourseId: null
};


const listeners = new Set();
export function subscribe(fn){ listeners.add(fn); return () => listeners.delete(fn); }
export function setState(patch){
Object.assign(state, patch);
for (const fn of listeners) fn(state);
}
