import { Filters } from "./components/Filters.js";
import { CourseList } from "./components/CourseList.js";


const app = document.getElementById("app");


function mount(){
app.innerHTML = "";
const filtersMount = document.createElement("div");
const listMount = document.createElement("div");
app.appendChild(filtersMount);
app.appendChild(listMount);
Filters(filtersMount);
CourseList(listMount);
}


mount();


document.getElementById("year").textContent = new Date().getFullYear();
