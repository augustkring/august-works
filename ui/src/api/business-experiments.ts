import type { BusinessExperimentView,BusinessExperimentVersionView,BusinessExperimentTransitionView,BusinessExperimentAssignmentView,BusinessExperimentExposureView,BusinessExperimentAnalysisView,
  CreateBusinessExperiment,AmendBusinessExperiment,TransitionBusinessExperiment,StartBusinessExperiment,AssignBusinessExperimentUnit,RecordBusinessExperimentExposure,ControlBusinessExperimentExecution,AnalyzeBusinessExperiment,InterpretBusinessExperiment } from "@paperclipai/shared";
import { api } from "./client";
const base=(companyId:string)=>`/companies/${encodeURIComponent(companyId)}/experiments`;
const root=(companyId:string,id:string)=>`${base(companyId)}/${encodeURIComponent(id)}`;
const account=(path:string,userId?:string|null)=>userId?`${path}${path.includes("?")?"&":"?"}expectedUserId=${encodeURIComponent(userId)}`:path;
export interface ExperimentInterpretation { id:string;analysisId:string;conclusion:"ship_candidate"|"do_not_ship"|"iterate"|"abstain";rationale:string;executionAuthority:"advisory_only";receiptHash:string;interpretedBy:string;interpretedAt:string }
export interface ExperimentReceipts {
 versionId:string;assignments:BusinessExperimentAssignmentView[];exposures:BusinessExperimentExposureView[];analysis:BusinessExperimentAnalysisView|null;interpretation:ExperimentInterpretation|null;
 recording:{mode:"recording_only_human_attested_native_process";startedBy:string;startedAt:string;receiptHash:string}|null;
 completion:{reason:"fixed_horizon"|"emergency_safety_stop"|"cancelled";concurrentChangeReview:{assessment:"none_identified"|"material_or_unknown";rationale:string};completedBy:string;completedAt:string;receiptHash:string}|null;
 exposureProvenance:"human_attestation";currentQualification:"current"|"needs_revalidation";
}
export interface ExperimentRecordingControl {id:string;companyId:string;versionId:string|null;revision:number;state:BusinessExperimentView["state"]}
export const businessExperimentsApi={
 safetyControls:(companyId:string,cursor?:string,userId?:string|null)=>api.get<{items:ExperimentRecordingControl[];nextCursor:string|null;coverage:"bounded_active_recording_control_metadata"}>(account(`${base(companyId)}/recording-controls${cursor?`?cursor=${encodeURIComponent(cursor)}`:""}`,userId),{cache:"no-store"}),
 list:(companyId:string,cursor?:string,userId?:string|null)=>api.get<{items:{experiment:BusinessExperimentView;version:BusinessExperimentVersionView}[];nextCursor:string|null;coverage:"bounded_current_authorized_page"}>(account(`${base(companyId)}${cursor?`?cursor=${encodeURIComponent(cursor)}`:""}`,userId),{cache:"no-store"}),
 detail:(companyId:string,id:string,userId?:string|null)=>api.get<{experiment:BusinessExperimentView;versions:BusinessExperimentVersionView[];transitions:BusinessExperimentTransitionView[];coverage:"bounded_recent_versions_and_transitions"}>(account(root(companyId,id),userId),{cache:"no-store"}),
 create:(companyId:string,input:CreateBusinessExperiment,userId?:string|null)=>api.post<{experiment:BusinessExperimentView;version:BusinessExperimentVersionView}>(account(base(companyId),userId),input),
 amend:(companyId:string,id:string,input:AmendBusinessExperiment,userId?:string|null)=>api.post<{experiment:BusinessExperimentView;version:BusinessExperimentVersionView}>(account(`${root(companyId,id)}/versions`,userId),input),
 transition:(companyId:string,id:string,input:TransitionBusinessExperiment,userId?:string|null)=>api.post<BusinessExperimentView>(account(`${root(companyId,id)}/transition`,userId),input),
 start:(companyId:string,id:string,input:StartBusinessExperiment,userId?:string|null)=>api.post<BusinessExperimentView>(account(`${root(companyId,id)}/start`,userId),input),
 assign:(companyId:string,id:string,input:AssignBusinessExperimentUnit,userId?:string|null)=>api.post<BusinessExperimentAssignmentView>(account(`${root(companyId,id)}/assignments`,userId),input),
 exposure:(companyId:string,id:string,input:RecordBusinessExperimentExposure,userId?:string|null)=>api.post<BusinessExperimentExposureView>(account(`${root(companyId,id)}/exposures`,userId),input),
 stop:(companyId:string,id:string,input:ControlBusinessExperimentExecution,userId?:string|null)=>api.post<BusinessExperimentView>(account(`${root(companyId,id)}/stop`,userId),input),
 receipts:(companyId:string,id:string,versionId:string,userId?:string|null)=>api.get<ExperimentReceipts>(account(`${root(companyId,id)}/versions/${encodeURIComponent(versionId)}/receipts`,userId),{cache:"no-store"}),
 analyze:(companyId:string,id:string,input:AnalyzeBusinessExperiment,userId?:string|null)=>api.post<{experiment:BusinessExperimentView;analysis:BusinessExperimentAnalysisView}>(account(`${root(companyId,id)}/analyze`,userId),input),
 interpret:(companyId:string,id:string,input:InterpretBusinessExperiment,userId?:string|null)=>api.post<{experiment:BusinessExperimentView;interpretation:ExperimentInterpretation}>(account(`${root(companyId,id)}/interpret`,userId),input),
};
