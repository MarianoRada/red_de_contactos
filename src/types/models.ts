export type RecordType='person'|'company'|'institution';
export interface ContactRecord {id:string;name:string;description:string;email?:string;location?:string;type:RecordType}
export type RelationshipType='colabora con'|'trabaja en'|'participa en'|'forma parte de'|'coordina'|'representa a'|'financia'|'está relacionado con';
export interface Relationship{id:string;sourceId:string;targetId:string;type:RelationshipType}
export interface AppData{records:ContactRecord[];relationships:Relationship[]}
export const relationshipTypes:RelationshipType[]=['colabora con','trabaja en','participa en','forma parte de','coordina','representa a','financia','está relacionado con'];
