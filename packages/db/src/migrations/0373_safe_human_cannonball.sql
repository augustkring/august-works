ALTER TABLE "agent_package_update_proposals" ALTER COLUMN "proposal" DROP NOT NULL;
--> statement-breakpoint
CREATE FUNCTION aw_v7_governance_authority_hash_without_package(c uuid,t uuid,a uuid,u text) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT encode(sha256(convert_to(jsonb_build_object(
  'task',jsonb_build_object('projectId',i.project_id,'parentId',i.parent_id,'assigneeAgentId',i.assignee_agent_id),
  'agent',jsonb_build_object('adapterType',ag.adapter_type,'adapterConfig',ag.adapter_config,'runtimeConfig',ag.runtime_config,'permissions',ag.permissions),
  'runtime',coalesce((SELECT jsonb_build_object('binding',r.provider_binding_id,'profile',r.provider_profile_ref,'status',r.status,'configuration',r.qualified_configuration_hash,'conformance',r.conformance_snapshot_hash,'snapshot',p.capability_snapshot_hash,'providerStatus',p.status) FROM agent_presence_runtime_bindings r JOIN agent_provider_bindings p ON p.id=r.provider_binding_id WHERE r.company_id=c AND r.agent_id=a),'{}'::jsonb),
  'managedRuntime',coalesce((SELECT jsonb_build_object('generation',rc.generation::text,'modelProvider',rc.model_provider,'modelId',rc.model_id,'secretRef',rc.model_secret_ref,'secretVersion',rc.model_secret_version,'desiredImage',rc.desired_image_digest,'activeImage',rc.active_image_digest,'sandboxBackend',sb.backend,'profile',sb.profile,'boundary',sb.boundary_policy_hash,'controls',sb.capability_snapshot-'testedAt'-'expiresAt'-'qualificationHash') FROM runtime_cells rc LEFT JOIN runtime_sandbox_bindings sb ON sb.company_id=rc.company_id AND sb.runtime_cell_id=rc.id AND sb.cell_generation=rc.generation::text WHERE rc.company_id=c AND rc.provider_binding_id=(SELECT r.provider_binding_id FROM agent_presence_runtime_bindings r WHERE r.company_id=c AND r.agent_id=a) LIMIT 1),'{}'::jsonb),
  -- Authority pointers only: never materialize private document/skill bodies.
  'foundation',coalesce((SELECT jsonb_agg(jsonb_build_object('id',f.id,'revision',f.approved_revision_id,'authority',f.authority_level,'status',f.status,'validFrom',f.valid_from,'validUntil',f.valid_until) ORDER BY f.id) FROM foundation_documents f WHERE f.company_id=c AND f.authority_level='canonical'),'[]'::jsonb),
  'skills',coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'current',s.current_version_id,'active',s.active_version_id,'state',s.lifecycle_state,'sharing',s.sharing_scope) ORDER BY s.id) FROM company_skills s WHERE s.company_id=c AND (s.owner_agent_id IS NULL OR s.owner_agent_id=a)),'[]'::jsonb),
  'playbooks',coalesce((SELECT jsonb_agg(jsonb_build_object('id',b.id,'revision',b.approved_revision_id,'status',b.status) ORDER BY b.id) FROM playbook_documents b WHERE b.company_id=c AND (b.owner_agent_id IS NULL OR b.owner_agent_id=a)),'[]'::jsonb),
  -- Organization overlays conservatively invalidate company deployments until reviewed.
  'rolePacks',coalesce((SELECT jsonb_agg(jsonb_build_object('id',r.id,'scope',r.scope_id,'policy',r.version_policy,'version',coalesce(r.pinned_version_id,p.published_version_id),'status',p.status) ORDER BY r.id) FROM agent_role_pack_assignments r JOIN role_packs p ON p.company_id=r.company_id AND p.id=r.role_pack_id WHERE r.company_id=c AND (r.scope_type<>'agent' OR r.scope_id=a)),'[]'::jsonb),
  'connections',coalesce((SELECT jsonb_agg(jsonb_build_object('id',g.id,'connection',g.connection_id,'status',g.status,'enabled',x.enabled,'connectionStatus',x.status,'configHash',encode(sha256(convert_to(x.config::text,'UTF8')),'hex')) ORDER BY g.id) FROM connection_grants g JOIN tool_connections x ON x.company_id=g.company_id AND x.id=g.connection_id WHERE g.company_id=c AND (g.subject_agent_id=a OR g.subject_user_id=u)),'[]'::jsonb),
  'obligations',coalesce((SELECT jsonb_agg(jsonb_build_object('id',o.id,'hash',o.obligation_hash,'nextReview',o.next_review_at) ORDER BY o.id) FROM governance_obligations o WHERE o.company_id=c),'[]'::jsonb),
  'grants',coalesce((SELECT jsonb_agg(jsonb_build_object('id',g.id,'principal',g.principal_id,'permission',g.permission_key,'scope',g.scope) ORDER BY g.id) FROM principal_permission_grants g WHERE g.company_id=c AND g.principal_id IN (a::text,u)),'[]'::jsonb)
 )::text,'UTF8')),'hex') FROM issues i JOIN agents ag ON ag.company_id=c AND ag.id=a WHERE i.company_id=c AND i.id=t;
$$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_v7_governance_authority_hash(c uuid,t uuid,a uuid,u text) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN EXISTS(SELECT 1 FROM company_agent_package_installations i WHERE i.company_id=c AND i.agent_id=a) THEN
 encode(sha256(convert_to(jsonb_build_object('native',aw_v7_governance_authority_hash_without_package(c,t,a,u),'packages',(SELECT jsonb_agg(jsonb_build_object('id',i.id,'version',i.installed_version_id,'state',i.status,'components',i.resolved_components,'activation',i.activation_hash,'releaseState',v.state,'releaseHash',v.content_hash) ORDER BY i.id) FROM company_agent_package_installations i JOIN agent_package_versions v ON v.id=i.installed_version_id WHERE i.company_id=c AND i.agent_id=a))::text,'UTF8')),'hex')
 ELSE aw_v7_governance_authority_hash_without_package(c,t,a,u) END;
$$;
