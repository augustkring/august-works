output "id" { value = upcloud_managed_object_storage.this.id }
output "endpoints" { value = upcloud_managed_object_storage.this.endpoint }
output "buckets" { value = { for key, bucket in upcloud_managed_object_storage_bucket.this : key => bucket.name } }
output "users" { value = { for key, user in upcloud_managed_object_storage_user.this : key => user.username } }

output "credentials" {
  value     = { for key, credential in upcloud_managed_object_storage_user_access_key.this : key => { access_key_id = credential.access_key_id, secret_access_key = credential.secret_access_key } }
  sensitive = true
}
