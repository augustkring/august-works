import type {DoWhyCausalProfile,CausalClaimView,CausalClaimVersionView,CausalAnalysisRunView,CreateCausalClaim,ReviseCausalClaim,ReviewCausalClaim,AnalyzeCausalClaim,RevokeCausalClaim} from "@paperclipai/shared";
import {api} from "./client";
const base=(companyId:string)=>`/companies/${encodeURIComponent(companyId)}/causal-claims`;
const root=(companyId:string,id:string)=>`${base(companyId)}/${encodeURIComponent(id)}`;
const account=(path:string,userId?:string|null)=>userId?`${path}${path.includes("?")?"&":"?"}expectedUserId=${encodeURIComponent(userId)}`:path;
export interface CausalReviewView {id:string;versionId:string;rationale:string;reviewedBy:string;reviewedAt:string;receiptHash:string}
export interface CausalDetail {claim:CausalClaimView;versions:{version:CausalClaimVersionView;review:CausalReviewView|null;run:CausalAnalysisRunView|null}[];coverage:"bounded_recent_native_versions"}
export const causalClaimsApi={
 providerProfile:(companyId:string,userId?:string|null)=>api.get<DoWhyCausalProfile>(account(`${base(companyId)}/provider-profile`,userId),{cache:"no-store"}),
 controls:(companyId:string,cursor?:string,userId?:string|null)=>api.get<{items:Pick<CausalClaimView,"id"|"companyId"|"revision"|"status">[];nextCursor:string|null;coverage:"bounded_native_revocation_metadata"}>(account(`${base(companyId)}/controls${cursor?`?cursor=${encodeURIComponent(cursor)}`:""}`,userId),{cache:"no-store"}),
 list:(companyId:string,cursor?:string,userId?:string|null)=>api.get<{items:{claim:CausalClaimView;version:CausalClaimVersionView;run:CausalAnalysisRunView|null}[];nextCursor:string|null;coverage:"bounded_current_authorized_page"}>(account(`${base(companyId)}${cursor?`?cursor=${encodeURIComponent(cursor)}`:""}`,userId),{cache:"no-store"}),
 detail:(companyId:string,id:string,userId?:string|null)=>api.get<CausalDetail>(account(root(companyId,id),userId),{cache:"no-store"}),
 create:(companyId:string,input:CreateCausalClaim,userId?:string|null)=>api.post<{claim:CausalClaimView;version:CausalClaimVersionView}>(account(base(companyId),userId),input),
 revise:(companyId:string,id:string,input:ReviseCausalClaim,userId?:string|null)=>api.post<{claim:CausalClaimView;version:CausalClaimVersionView}>(account(`${root(companyId,id)}/versions`,userId),input),
 review:(companyId:string,id:string,input:ReviewCausalClaim,userId?:string|null)=>api.post<CausalClaimView>(account(`${root(companyId,id)}/review`,userId),input),
 analyze:(companyId:string,id:string,input:AnalyzeCausalClaim,userId?:string|null)=>api.post<{claim:CausalClaimView;run:CausalAnalysisRunView}>(account(`${root(companyId,id)}/analyze`,userId),input),
 revoke:(companyId:string,id:string,input:RevokeCausalClaim,userId?:string|null)=>api.post<CausalClaimView>(account(`${root(companyId,id)}/revoke`,userId),input),
};
