import {Router,type Request} from "express";
import {z} from "zod";
import type {Db} from "@paperclipai/db";
import {proposeDecisionContextSchema,prepareDecisionContextSchema,withdrawPreparedDecisionContextSchema} from "@paperclipai/shared";
import {badRequest,conflict} from "../errors.js";
import {validate} from "../middleware/validate.js";
import {assertCompanyAccess} from "./authz.js";
import {decisionIntelligenceService} from "../services/decision-intelligence.js";
function id(value:unknown) {const parsed=z.string().uuid().safeParse(value);if(!parsed.success) throw badRequest("Invalid native decision identity");return parsed.data;}
function company(req:Request) {
  if(Object.keys(req.query).some(key=>key!=="expectedUserId")) throw badRequest("Unknown decision context filter");
  if(req.query.expectedUserId!==undefined && (typeof req.query.expectedUserId!=="string" || req.actor.type!=="board" || req.actor.userId!==req.query.expectedUserId)) throw conflict("Account changed; reload this decision",{code:"ACCOUNT_CHANGED"});
  const companyId=id(req.params.companyId);assertCompanyAccess(req,companyId);return companyId;
}
export function decisionIntelligenceRoutes(db:Db) {
  const router=Router(),service=decisionIntelligenceService(db),path="/companies/:companyId/decisions/:decisionId/context";
  router.use(path,(_req,res,next)=>{res.setHeader("Cache-Control","no-store");next();});
  router.get(path,async(req,res)=>res.json(await service.detail(company(req),req.actor,id(req.params.decisionId))));
  router.post(`${path}/versions`,validate(proposeDecisionContextSchema),async(req,res)=>res.status(201).json(await service.propose(company(req),req.actor,id(req.params.decisionId),req.body)));
  router.post(`${path}/prepare`,validate(prepareDecisionContextSchema),async(req,res)=>res.json(await service.prepare(company(req),req.actor,id(req.params.decisionId),req.body)));
  router.post(`${path}/withdraw`,validate(withdrawPreparedDecisionContextSchema),async(req,res)=>res.json(await service.withdraw(company(req),req.actor,id(req.params.decisionId),req.body)));
  return router;
}
