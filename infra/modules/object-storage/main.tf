resource "upcloud_managed_object_storage" "this" {
  name              = "${var.prefix}-objects"
  region            = var.region
  configured_status = "started"
  labels            = var.labels
  network {
    name   = "private"
    type   = "private"
    family = "IPv4"
    uuid   = var.network_id
  }
}
resource "upcloud_managed_object_storage_bucket" "this" {
  for_each     = toset(["artifacts", "runtime-backups", "db-backups", "exports"])
  service_uuid = upcloud_managed_object_storage.this.id
  name         = "${var.prefix}-${each.key}"
  lifecycle { prevent_destroy = true }
}
locals {
  identities = {
    app = {
      buckets = ["artifacts", "exports"]
      actions = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:DeleteObjectVersion"]
    }
    runtime_backup_writer = {
      buckets = ["runtime-backups"]
      actions = ["s3:PutObject"]
    }
    db_backup_writer = {
      buckets = ["db-backups"]
      actions = ["s3:PutObject"]
    }
    restore_reader = {
      buckets = ["runtime-backups", "db-backups"]
      actions = ["s3:GetObject"]
    }
    retention_operator = {
      buckets = ["runtime-backups", "db-backups"]
      actions = ["s3:GetObject", "s3:DeleteObject", "s3:DeleteObjectVersion"]
    }
  }
}
resource "upcloud_managed_object_storage_user" "this" {
  for_each     = local.identities
  service_uuid = upcloud_managed_object_storage.this.id
  username     = "${var.prefix}-${each.key}"
}
resource "upcloud_managed_object_storage_policy" "this" {
  for_each     = local.identities
  service_uuid = upcloud_managed_object_storage.this.id
  name         = "${var.prefix}-${each.key}"
  document = urlencode(jsonencode({
    Version = "2012-10-17"
    Statement = concat([
      {
        Effect   = "Allow"
        Action   = each.value.actions
        Resource = [for bucket in each.value.buckets : "arn:aws:s3:::${upcloud_managed_object_storage_bucket.this[bucket].name}/*"]
      }
      ], contains(["runtime_backup_writer", "db_backup_writer"], each.key) ? [] : [
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket", "s3:ListBucketVersions"]
        Resource = [for bucket in each.value.buckets : "arn:aws:s3:::${upcloud_managed_object_storage_bucket.this[bucket].name}"]
      }
    ])
  }))
}
resource "upcloud_managed_object_storage_user_policy" "this" {
  for_each     = local.identities
  service_uuid = upcloud_managed_object_storage.this.id
  username     = upcloud_managed_object_storage_user.this[each.key].username
  name         = upcloud_managed_object_storage_policy.this[each.key].name
}

resource "upcloud_managed_object_storage_user_access_key" "this" {
  for_each     = local.identities
  service_uuid = upcloud_managed_object_storage.this.id
  username     = upcloud_managed_object_storage_user.this[each.key].username
  status       = "Active"
  lifecycle { create_before_destroy = true }
}
