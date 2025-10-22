import { state, setState, subscribe } from "../state.js";


export function Filters(root){
const el = document.createElement("section");
el.className = "card";
el.innerHTML = `
<div class="filters" role="region" aria-label="Filters">
<label>Rotation<br/>
<select id="rotationSel" aria-label="Select rotation">
<option value="">All</option>
<option value="1">(R1)</option>
<option value="2">(R2)</option>
<option value="3">(R3)</option>
<option value="4">(R4)</option>
</select>
</label>
<label>Search<br/>
<input id="searchInp" type="search" placeholder="Search courses/topics…" />
</label>
<button id="clearBtn" type="button">Clear</button>
</div>
`;
const rotationSel = el.querySelector("#rotationSel");
const searchInp = el.querySelector("#searchInp");
const clearBtn = el.querySelector("#clearBtn");


rotationSel.addEventListener("change", () =>
setState({ rotation: rotationSel.value || null })
);
searchInp.addEventListener("input", () =>
setState({ search: searchInp.value.trim() })
);
clearBtn.addEventListener("click", () => {
rotationSel.value = ""; searchInp.value = "";
setState({ rotation:null, search:"" });
});


subscribe(s => {
rotationSel.value = s.rotation ?? "";
searchInp.value = s.search ?? "";
});


root.appendChild(el);
}
