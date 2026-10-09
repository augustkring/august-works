-- Current Memory time admission must advance during a long native execution
-- transaction. Transaction-start now() can admit an already expired Source.
CREATE OR REPLACE FUNCTION aw_learning_link_current(p_company uuid, p_link uuid) RETURNS boolean LANGUAGE sql VOLATILE AS $$
 SELECT EXISTS (SELECT 1 FROM learning_domain_candidates l
 JOIN learning_hypotheses h ON h.company_id=l.company_id AND h.id=l.hypothesis_id
 JOIN learning_cycles c ON c.company_id=h.company_id AND c.id=h.cycle_id
 JOIN learning_evaluations e ON e.company_id=l.company_id AND e.id=l.evaluation_id
 WHERE l.company_id=p_company AND l.id=p_link AND l.invalidated_at IS NULL AND l.erased_at IS NULL
 AND NOT aw_learning_cycle_erased(c.company_id,c.id) AND c.erased_at IS NULL AND c.status NOT IN ('failed','cancelled') AND h.erased_at IS NULL AND e.erased_at IS NULL AND e.result='passed'
 AND EXISTS (SELECT 1 FROM learning_evidence r WHERE r.company_id=c.company_id AND r.cycle_id=c.id)
 AND NOT EXISTS (SELECT 1 FROM learning_evidence r LEFT JOIN memory_records m ON m.company_id=r.company_id AND m.id=r.memory_record_id
 WHERE r.company_id=c.company_id AND r.cycle_id=c.id AND (m.id IS NULL OR date_trunc('milliseconds',m.updated_at)<>r.source_version::timestamptz
 OR m.verification_state NOT IN ('human_verified','system_verified','corroborated')
 OR m.review_state<>'accepted' OR m.retention_state<>'active' OR m.deleted_at IS NOT NULL OR m.revoked_at IS NOT NULL OR m.superseded_by_record_id IS NOT NULL
 OR m.owner_agent_id IS NOT NULL OR m.scope_type<>c.scope_type OR m.scope_id IS DISTINCT FROM c.scope_id
 OR m.valid_from>clock_timestamp() OR m.valid_until<=clock_timestamp() OR m.expires_at<=clock_timestamp()
 OR (jsonb_typeof(m.metadata->'allowedPurposes')='array' AND NOT (m.metadata->'allowedPurposes' ? c.purpose))
 OR EXISTS (SELECT 1 FROM memory_deletion_markers d WHERE d.company_id=m.company_id AND d.record_id=m.id)))
 AND EXISTS (SELECT 1 FROM jsonb_each_text(e.outcome_versions))
 AND NOT EXISTS (SELECT 1 FROM jsonb_each_text(e.outcome_versions) v LEFT JOIN issues i ON i.company_id=e.company_id AND i.id=v.key::uuid
 WHERE i.id IS NULL OR i.status<>'done' OR i.completed_at IS NULL OR date_trunc('milliseconds',i.updated_at)<>v.value::timestamptz
 OR (c.scope_type='project' AND i.project_id::text IS DISTINCT FROM c.scope_id)))
$$;
