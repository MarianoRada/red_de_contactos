import type {AppData,ContactRecord,Relationship} from '../types/models';
export const getRelationsFor=(id:string,rs:Relationship[])=>rs.filter(r=>r.sourceId===id||r.targetId===id);
export const getOtherId=(r:Relationship,id:string)=>r.sourceId===id?r.targetId:r.sourceId;
export const getRecord=(id:string,records:ContactRecord[])=>records.find(r=>r.id===id);
export function addRecord(data:AppData,record:ContactRecord):AppData{return {...data,records:[...data.records,record]}}
export function updateRecord(data:AppData,record:ContactRecord):AppData{return {...data,records:data.records.map(r=>r.id===record.id?record:r)}}
export function deleteRecord(data:AppData,id:string):AppData{return {records:data.records.filter(r=>r.id!==id),relationships:data.relationships.filter(r=>r.sourceId!==id&&r.targetId!==id)}}
export function addRelationship(data:AppData,rel:Relationship):AppData{return {...data,relationships:[...data.relationships,rel]}}
export function deleteRelationship(data:AppData,id:string):AppData{return {...data,relationships:data.relationships.filter(r=>r.id!==id)}}
