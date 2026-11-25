export const DEFAULT_MAX_EVIDENCE_AGE_DAYS=1096;
export function evidenceAge(entry,{assessmentDate=new Date().toISOString().slice(0,10),maxEvidenceAgeDays=DEFAULT_MAX_EVIDENCE_AGE_DAYS}={}){
 const date=entry.parsed?.date||entry.observedDate||null;
 const parsed=date&&/^\d{4}-\d{2}-\d{2}$/.test(date)?Date.parse(date+'T00:00:00Z'):NaN;
 const at=Date.parse(assessmentDate+'T00:00:00Z');
 if(!Number.isFinite(at)||!Number.isFinite(maxEvidenceAgeDays)||maxEvidenceAgeDays<=0)throw Error('GPX日期判定設定不合法');
 if(!Number.isFinite(parsed)||new Date(parsed).toISOString().slice(0,10)!==date)return {status:'UNKNOWN_DATE',date,assessmentDate,eligible:false,reason:'缺少可核對的實際行走日期；上傳日期不能代替，僅作歷史／片段參考'};
 const ageDays=Math.floor((at-parsed)/86400000);
 if(ageDays< -1)return {status:'FUTURE_DATE',date,assessmentDate,ageDays,eligible:false,reason:'軌跡時間晚於本輪日期，需查記錄器時間設定'};
 if(ageDays>maxEvidenceAgeDays)return {status:'HISTORICAL_ONLY',date,assessmentDate,ageDays,eligible:false,reason:`實際行走日期超過${maxEvidenceAgeDays}天，僅歷史輔助；不能據此通過或覆蓋近期變更證據`};
 return {status:'RECENT_REFERENCE',date,assessmentDate,ageDays,eligible:true,reason:'日期符合優先範圍；仍需獨立來源、完整性、變體及模式檢查'};
}
