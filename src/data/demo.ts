import type {AppData,ContactRecord,Relationship} from '../types/models';
const records:ContactRecord[]=[
{id:'maria',name:'María Gómez',description:'Gestora de proyectos y articuladora de iniciativas educativas.',email:'maria@ejemplo.org',location:'Buenos Aires',type:'person'},
{id:'juan',name:'Juan Pérez',description:'Investigador y consultor en innovación social.',email:'juan@ejemplo.org',location:'Córdoba',type:'person'},
{id:'lucia',name:'Lucía Fernández',description:'Coordinadora de programas de formación.',email:'lucia@ejemplo.org',location:'Rosario',type:'person'},
{id:'carlos',name:'Carlos Rodríguez',description:'Especialista en tecnología educativa.',email:'carlos@ejemplo.org',location:'Buenos Aires',type:'person'},
{id:'horizonte',name:'Fundación Horizonte',description:'Organización dedicada a proyectos educativos y comunitarios.',email:'contacto@horizonte.org',location:'Buenos Aires',type:'institution'},
{id:'universidad',name:'Universidad Nacional',description:'Institución académica.',email:'info@universidad.edu',location:'Córdoba',type:'institution'},
{id:'innovar',name:'Empresa Innovar',description:'Empresa dedicada al desarrollo de herramientas digitales.',email:'hola@innovar.com',location:'Buenos Aires',type:'company'},
{id:'comunidades',name:'Red Comunidades',description:'Red de organizaciones y referentes territoriales.',email:'red@comunidades.org',location:'Rosario',type:'institution'},
{id:'educacion',name:'Educación Digital 2026',description:'Programa de innovación y transformación educativa.',type:'institution'},
{id:'redinnovacion',name:'Red de Innovación',description:'Iniciativa para conectar organizaciones y referentes.',type:'institution'},
{id:'programa',name:'Programa Comunidades',description:'Programa de articulación entre organizaciones territoriales.',type:'institution'}];
const r=(id:string,sourceId:string,targetId:string,type:Relationship['type']):Relationship=>({id,sourceId,targetId,type});
const relationships=[r('r1','maria','horizonte','trabaja en'),r('r2','maria','educacion','coordina'),r('r3','juan','universidad','colabora con'),r('r4','juan','redinnovacion','participa en'),r('r5','lucia','comunidades','forma parte de'),r('r6','lucia','programa','coordina'),r('r7','carlos','innovar','trabaja en'),r('r8','carlos','educacion','participa en'),r('r9','horizonte','educacion','participa en'),r('r10','universidad','redinnovacion','participa en'),r('r11','innovar','educacion','colabora con'),r('r12','comunidades','programa','coordina'),r('r13','horizonte','comunidades','colabora con'),r('r14','maria','lucia','colabora con'),r('r15','juan','carlos','colabora con')];
export const demoData:AppData={records,relationships};
