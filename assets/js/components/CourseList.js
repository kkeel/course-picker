import { state, subscribe, setState } from "../state.js";
import { courses, topics } from "../data/topics.js";


function filteredCourses(){
const { rotation, search } = state;
return courses.filter(c => {
const matchRot = !rotation || (c.rotations || []).includes(+rotation);
const hay = `${c.title} ${c.description||""}`.toLowerCase();
const matchSearch = !search || hay.includes(search.toLowerCase());
return matchRot && matchSearch;
});
}


export function CourseList(root){
const el = document.createElement("section");
el.className = "grid cols-2";
const left = document.createElement("div"); left.className = "card";
const right = document.createElement("div"); right.className = "card";
left.setAttribute("aria-label","Courses"); right.setAttribute("aria-label","Topic Band");


function render(){
const list = filteredCourses();


left.innerHTML = `
<h2>Courses (${list.length})</h2>
<ul>
${list.map(c => `
<li>
<button data-id="${c.id}" aria-pressed="${state.selectedCourseId===c.id}">
${c.title}
</button>
</li>`).join("")}
</ul>
`;


// pick a selected course (persist if already chosen)
const selected = courses.find(c => c.id === state.selectedCourseId) || list[0];
if (selected && state.selectedCourseId !== selected.id) {
setState({ selectedCourseId: selected.id });
}


const courseTopics = topics.filter(t => t.courseId === (selected?.id || ""));


// Topic band: ONLY course-level data here (no repeating per-topic descriptions)
right.innerHTML = selected ? `
<h2>Topic Band</h2>
<div class="badge" title="Course">${selected.title}</div>
${selected.description ? `<p>${selected.description}</p>` : ""}
<div style="margin-top:12px">
${courseTopics.map(t => `<span class="badge">${t.label}</span>`).join(" ")}
</div>
` : `<p>Select a course to see its topics.</p>`;
}


left.addEventListener("click", (e) => {
const btn = e.target.closest("button[data-id]");
if (!btn) return;
setState({ selectedCourseId: btn.dataset.id });
});


subscribe(render);
render();


el.appendChild(left);
el.appendChild(right);
root.appendChild(el);
}
