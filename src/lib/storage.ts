import {demoData} from '../data/demo'; import type {AppData} from '../types/models';
const KEY='red-contactos:v1'; const clone=()=>JSON.parse(JSON.stringify(demoData)) as AppData;
export function loadData():AppData{try{const raw=localStorage.getItem(KEY);if(raw)return JSON.parse(raw)}catch{} const d=clone();saveData(d);return d}
export function saveData(data:AppData){localStorage.setItem(KEY,JSON.stringify(data))}
export function resetData(){localStorage.removeItem(KEY);const d=clone();saveData(d);return d}
