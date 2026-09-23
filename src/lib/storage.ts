import {demoData} from '../data/demo'; import type {AppData,ContactRecord} from '../types/models';
const KEY='red-contactos:v1'; const clone=()=>JSON.parse(JSON.stringify(demoData)) as AppData;
export function loadData():AppData{try{const raw=localStorage.getItem(KEY);if(raw){const data=JSON.parse(raw) as AppData; if(!Array.isArray(data.records)||!Array.isArray(data.relationships))throw new Error('Datos inválidos'); let changed=false; for(const record of data.records){const oldType=(record as ContactRecord & {type:string}).type; if(oldType==='organization'||oldType==='project'){record.type=oldType==='organization'?'company':'institution';changed=true}} if(changed)saveData(data); return data}}catch{} const d=clone();saveData(d);return d}
export function saveData(data:AppData){localStorage.setItem(KEY,JSON.stringify(data))}
export function resetData(){localStorage.removeItem(KEY);const d=clone();saveData(d);return d}
