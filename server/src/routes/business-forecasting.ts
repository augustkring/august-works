import {Router,type Request} from "express";
import {z} from "zod";
import type {Db} from "@paperclipai/db";
import {createBusinessForecastSpecSchema,reviseBusinessForecastSpecSchema,backtestBusinessForecastSchema,publishBusinessForecastSpecSchema,retireBusinessForecastSpecSchema} from "@paperclipai/shared";
import {validate} from "../middleware/validate.js";
import {assertCompanyAccess} from "./authz.js";
import {badRequest,conflict} from "../errors.js";
import {businessForecastService} from "../services/business-forecasting/service.js";
function id(value:unknown) {const parsed=z.string().uuid().safeParse(value);if(!parsed.success) throw badRequest("Invalid forecast identity");return parsed.data;}
function companyAccess(req:Request,companyId:string,allowed:string[]=[]) {
 if(Object.keys(req.query).some(key=>key!=="expectedUserId"&&!allowed.includes(key))) throw badRequest("Unknown forecast query field");
 if(req.query.expectedUserId!==undefined&&(typeof req.query.expectedUserId!=="string"||req.actor.type!=="board"||req.actor.userId!==req.query.expectedUserId)) throw conflict("Account changed; reload this page",{code:"ACCOUNT_CHANGED"});
 assertCompanyAccess(req,companyId);
}
export function businessForecastRoutes(db:Db) {
 const router=Router(),service=businessForecastService(db),base="/companies/:companyId/business-forecasts";
 router.use(base,(_req,res,next)=>{res.setHeader("Cache-Control","no-store");next();});
 router.get("/companies/:companyId/business-forecasts",async(req,res)=>{const companyId=id(req.params.companyId);companyAccess(req,companyId,["cursor"]);res.json(await service.list(companyId,req.actor,req.query.cursor===undefined?undefined:id(req.query.cursor)));});
 router.get(`/companies/:companyId/business-forecasts/:specId`,async(req,res)=>{const companyId=id(req.params.companyId);companyAccess(req,companyId);res.json(await service.detail(companyId,req.actor,id(req.params.specId)));});
 router.post("/companies/:companyId/business-forecasts",validate(createBusinessForecastSpecSchema),async(req,res)=>{const companyId=id(req.params.companyId);companyAccess(req,companyId);res.status(201).json(await service.create(companyId,req.actor,req.body));});
 router.post(`/companies/:companyId/business-forecasts/:specId/versions`,validate(reviseBusinessForecastSpecSchema),async(req,res)=>{const companyId=id(req.params.companyId);companyAccess(req,companyId);res.status(201).json(await service.revise(companyId,req.actor,id(req.params.specId),req.body));});
 router.post(`/companies/:companyId/business-forecasts/:specId/backtests`,validate(backtestBusinessForecastSchema),async(req,res)=>{const companyId=id(req.params.companyId);companyAccess(req,companyId);res.status(201).json(await service.backtest(companyId,req.actor,id(req.params.specId),req.body));});
 router.post(`/companies/:companyId/business-forecasts/:specId/publish`,validate(publishBusinessForecastSpecSchema),async(req,res)=>{const companyId=id(req.params.companyId);companyAccess(req,companyId);res.json(await service.publish(companyId,req.actor,id(req.params.specId),req.body));});
 router.post(`/companies/:companyId/business-forecasts/:specId/runs`,validate(backtestBusinessForecastSchema),async(req,res)=>{const companyId=id(req.params.companyId);companyAccess(req,companyId);res.status(201).json(await service.run(companyId,req.actor,id(req.params.specId),req.body));});
 router.post(`/companies/:companyId/business-forecasts/:specId/retire`,validate(retireBusinessForecastSpecSchema),async(req,res)=>{const companyId=id(req.params.companyId);companyAccess(req,companyId);res.json(await service.retire(companyId,req.actor,id(req.params.specId),req.body));});
 router.get("/companies/:companyId/business-forecasts/:specId/backtests",async(req,res)=>{const companyId=id(req.params.companyId);companyAccess(req,companyId,["cursor"]);res.json(await service.listArtifacts(companyId,req.actor,id(req.params.specId),"backtest",req.query.cursor===undefined?undefined:id(req.query.cursor)));});
 router.get("/companies/:companyId/business-forecasts/:specId/runs",async(req,res)=>{const companyId=id(req.params.companyId);companyAccess(req,companyId,["cursor"]);res.json(await service.listArtifacts(companyId,req.actor,id(req.params.specId),"run",req.query.cursor===undefined?undefined:id(req.query.cursor)));});
 router.get(`/companies/:companyId/business-forecasts/:specId/backtests/:artifactId`,async(req,res)=>{const companyId=id(req.params.companyId);companyAccess(req,companyId);res.json(await service.artifact(companyId,req.actor,id(req.params.specId),id(req.params.artifactId),"backtest"));});
 router.get(`/companies/:companyId/business-forecasts/:specId/runs/:artifactId`,async(req,res)=>{const companyId=id(req.params.companyId);companyAccess(req,companyId);res.json(await service.artifact(companyId,req.actor,id(req.params.specId),id(req.params.artifactId),"run"));});
 return router;
}
