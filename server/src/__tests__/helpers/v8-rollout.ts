import type {Db} from "@paperclipai/db";
import {V8_FEATURE_KEYS,v8FeatureFlagsSchema} from "@paperclipai/shared";
import {instanceSettingsService} from "../../services/instance-settings.js";
/** The settings write API patches existing flags. An empty patch is a no-op. */
export async function disableV8Rollout(db:Db){
 const settings=instanceSettingsService(db,{runtimeEnv:{}});
 await settings.updateExperimental(v8FeatureFlagsSchema.parse({}));
 const current=await settings.getExperimental();
 for(const key of V8_FEATURE_KEYS)if(current[key]!==false)throw new Error(`V8 rollout fixture did not disable ${key}`);
}
