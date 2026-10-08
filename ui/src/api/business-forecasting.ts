import type {StatisticalForecastProviderInfo,BusinessForecastSpecView,BusinessForecastVersionView,BusinessForecastArtifactView,CreateBusinessForecastSpec,ReviseBusinessForecastSpec,BacktestBusinessForecast,PublishBusinessForecastSpec,RetireBusinessForecastSpec} from "@paperclipai/shared";
import {api} from "./client";
const base=(companyId:string)=>`/companies/${encodeURIComponent(companyId)}/business-forecasts`;
const account=(path:string,userId?:string|null)=>userId?`${path}${path.includes("?")?"&":"?"}expectedUserId=${encodeURIComponent(userId)}`:path;
const spec=(companyId:string,id:string)=>`${base(companyId)}/${encodeURIComponent(id)}`;
export const businessForecastingApi={
 providerProfile:(companyId:string,userId?:string|null)=>api.get<StatisticalForecastProviderInfo>(account(`${base(companyId)}/provider-profile`,userId),{cache:"no-store"}),
 list:(companyId:string,cursor?:string,userId?:string|null)=>api.get<{items:BusinessForecastSpecView[];nextCursor:string|null;coverage:"bounded_current_authorized_page"}>(account(`${base(companyId)}${cursor?`?cursor=${encodeURIComponent(cursor)}`:""}`,userId),{cache:"no-store"}),
 detail:(companyId:string,id:string,userId?:string|null)=>api.get<{spec:BusinessForecastSpecView;versions:BusinessForecastVersionView[]}>(account(spec(companyId,id),userId),{cache:"no-store"}),
 create:(companyId:string,input:CreateBusinessForecastSpec,userId?:string|null)=>api.post<{spec:BusinessForecastSpecView;version:BusinessForecastVersionView}>(account(base(companyId),userId),input),
 revise:(companyId:string,id:string,input:ReviseBusinessForecastSpec,userId?:string|null)=>api.post<{spec:BusinessForecastSpecView;version:BusinessForecastVersionView}>(account(`${spec(companyId,id)}/versions`,userId),input),
 backtest:(companyId:string,id:string,input:BacktestBusinessForecast,userId?:string|null)=>api.post<BusinessForecastArtifactView>(account(`${spec(companyId,id)}/backtests`,userId),input),
 publish:(companyId:string,id:string,input:PublishBusinessForecastSpec,userId?:string|null)=>api.post<BusinessForecastSpecView>(account(`${spec(companyId,id)}/publish`,userId),input),
 run:(companyId:string,id:string,input:BacktestBusinessForecast,userId?:string|null)=>api.post<BusinessForecastArtifactView>(account(`${spec(companyId,id)}/runs`,userId),input),
 retire:(companyId:string,id:string,input:RetireBusinessForecastSpec,userId?:string|null)=>api.post<BusinessForecastSpecView>(account(`${spec(companyId,id)}/retire`,userId),input),
 artifacts:(companyId:string,id:string,kind:"backtest"|"run",cursor?:string,userId?:string|null)=>api.get<{items:BusinessForecastArtifactView[];nextCursor:string|null;coverage:"bounded_current_authorized_page"}>(account(`${spec(companyId,id)}/${kind==="backtest"?"backtests":"runs"}${cursor?`?cursor=${encodeURIComponent(cursor)}`:""}`,userId),{cache:"no-store"}),
 artifact:(companyId:string,id:string,artifactId:string,kind:"backtest"|"run",userId?:string|null)=>api.get<BusinessForecastArtifactView>(account(`${spec(companyId,id)}/${kind==="backtest"?"backtests":"runs"}/${encodeURIComponent(artifactId)}`,userId),{cache:"no-store"}),
};
