export const courses = [
{ id:"c1", title:"Bible: Grade 1", grades:[1], rotations:[1,2], description:"Bible course for Grade 1." },
{ id:"c2", title:"History: Grades 1–6", grades:[1,2,3,4,5,6], rotations:[2,3,4], description:"Survey of early modern history." },
{ id:"c3", title:"Citizenship: Grade 4", grades:[4], rotations:[1,3], description:"Foundations of citizenship and character." }
];


export const topics = [
{ id:"t1", courseId:"c1", label:"Bible Stories" },
{ id:"t2", courseId:"c1", label:"Church History: Grades 1–6" },
{ id:"t3", courseId:"c2", label:"Explorers & Empires" },
{ id:"t4", courseId:"c2", label:"Colonial America" },
{ id:"t5", courseId:"c3", label:"Virtues & Vices" },
{ id:"t6", courseId:"c3", label:"Habits & Duties" }
];
