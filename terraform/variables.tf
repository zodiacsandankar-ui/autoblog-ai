# =============================================================================
# Terraform Variables - AutoBlog AI
# =============================================================================

# ---------------------------------------------------------------------------
# General Project Variables
# ---------------------------------------------------------------------------
variable "project_name" {
  description = "Name of the project"
  type        = string
  default     = "autoblog-ai"
}

variable "environment" {
  description = "Deployment environment (production, staging, development)"
  type        = string
  default     = "production"

  validation {
    condition     = contains(["production", "staging", "development"], var.environment)
    error_message = "Environment must be one of: production, staging, development."
  }
}

variable "aws_region" {
  description = "AWS region for all resources"
  type        = string
  default     = "us-east-1"
}

variable "tags" {
  description = "Additional tags for all resources"
  type        = map(string)
  default     = {}
}

# ---------------------------------------------------------------------------
# Networking / VPC Variables
# ---------------------------------------------------------------------------
variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "vpc_availability_zones" {
  description = "List of availability zones for the VPC"
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b", "us-east-1c"]
}

variable "vpc_private_subnets" {
  description = "CIDR blocks for private subnets"
  type        = list(string)
  default     = ["10.0.1.0/24", "10.0.2.0/24", "10.0.3.0/24"]
}

variable "vpc_public_subnets" {
  description = "CIDR blocks for public subnets"
  type        = list(string)
  default     = ["10.0.101.0/24", "10.0.102.0/24", "10.0.103.0/24"]
}

variable "vpc_database_subnets" {
  description = "CIDR blocks for database subnets"
  type        = list(string)
  default     = ["10.0.201.0/24", "10.0.202.0/24", "10.0.203.0/24"]
}

variable "vpc_enable_nat_gateway" {
  description = "Enable NAT gateway for private subnets"
  type        = bool
  default     = true
}

variable "vpc_single_nat_gateway" {
  description = "Use a single NAT gateway (cost-saving for non-prod)"
  type        = bool
  default     = false
}

variable "vpc_enable_vpn_gateway" {
  description = "Enable VPN gateway"
  type        = bool
  default     = false
}

# ---------------------------------------------------------------------------
# EKS Cluster Variables
# ---------------------------------------------------------------------------
variable "eks_cluster_name" {
  description = "Name of the EKS cluster"
  type        = string
  default     = "autoblog-ai-eks"
}

variable "eks_cluster_version" {
  description = "Kubernetes version for the EKS cluster"
  type        = string
  default     = "1.30"
}

variable "eks_node_group_name" {
  description = "Name of the EKS node group"
  type        = string
  default     = "autoblog-ai-ng"
}

variable "eks_node_instance_types" {
  description = "Instance types for the EKS node group"
  type        = list(string)
  default     = ["t3.medium", "t3.large"]
}

variable "eks_node_desired_size" {
  description = "Desired number of nodes in the node group"
  type        = number
  default     = 3
}

variable "eks_node_min_size" {
  description = "Minimum number of nodes in the node group"
  type        = number
  default     = 3
}

variable "eks_node_max_size" {
  description = "Maximum number of nodes in the node group"
  type        = number
  default     = 20
}

variable "eks_node_disk_size" {
  description = "Disk size in GB for EKS nodes"
  type        = number
  default     = 50
}

variable "eks_enable_cluster_autoscaler" {
  description = "Enable cluster autoscaler add-on"
  type        = bool
  default     = true
}

variable "eks_enable_metrics_server" {
  description = "Enable metrics server add-on"
  type        = bool
  default     = true
}

# ---------------------------------------------------------------------------
# RDS (PostgreSQL) Variables
# ---------------------------------------------------------------------------
variable "rds_instance_class" {
  description = "Instance class for RDS PostgreSQL"
  type        = string
  default     = "db.t3.medium"
}

variable "rds_allocated_storage" {
  description = "Allocated storage in GB for RDS"
  type        = number
  default     = 50
}

variable "rds_max_allocated_storage" {
  description = "Maximum allocated storage in GB for RDS autoscaling"
  type        = number
  default     = 200
}

variable "rds_storage_type" {
  description = "Storage type for RDS"
  type        = string
  default     = "gp3"
  validation {
    condition     = contains(["gp2", "gp3", "io1", "io2"], var.rds_storage_type)
    error_message = "Storage type must be one of: gp2, gp3, io1, io2."
  }
}

variable "rds_engine_version" {
  description = "PostgreSQL engine version"
  type        = string
  default     = "16.3"
}

variable "rds_database_name" {
  description = "Name of the PostgreSQL database"
  type        = string
  default     = "autoblog"
}

variable "rds_database_username" {
  description = "Master username for PostgreSQL"
  type        = string
  default     = "autoblog"
  sensitive   = true
}

variable "rds_database_password" {
  description = "Master password for PostgreSQL"
  type        = string
  sensitive   = true
}

variable "rds_multi_az" {
  description = "Enable Multi-AZ deployment for RDS"
  type        = bool
  default     = true
}

variable "rds_backup_retention_period" {
  description = "Backup retention period in days for RDS"
  type        = number
  default     = 30
}

variable "rds_backup_window" {
  description = "Preferred backup window for RDS (UTC)"
  type        = string
  default     = "03:00-04:00"
}

variable "rds_maintenance_window" {
  description = "Preferred maintenance window for RDS (UTC)"
  type        = string
  default     = "sun:04:00-sun:05:00"
}

variable "rds_deletion_protection" {
  description = "Enable deletion protection for RDS"
  type        = bool
  default     = true
}

variable "rds_skip_final_snapshot" {
  description = "Skip final snapshot on RDS deletion (production should be false)"
  type        = bool
  default     = false
}

# ---------------------------------------------------------------------------
# ElastiCache (Redis) Variables
# ---------------------------------------------------------------------------
variable "elasticache_node_type" {
  description = "Instance type for ElastiCache Redis nodes"
  type        = string
  default     = "cache.t3.medium"
}

variable "elasticache_num_cache_nodes" {
  description = "Number of cache nodes in the replication group"
  type        = number
  default     = 2
}

variable "elasticache_engine_version" {
  description = "Redis engine version"
  type        = string
  default     = "7.1"
}

variable "elasticache_parameter_group_name" {
  description = "Parameter group name for ElastiCache"
  type        = string
  default     = "default.redis7"
}

variable "elasticache_port" {
  description = "Port for ElastiCache Redis"
  type        = number
  default     = 6379
}

variable "elasticache_snapshot_retention_limit" {
  description = "Snapshot retention limit in days for ElastiCache"
  type        = number
  default     = 7
}

variable "elasticache_apply_immediately" {
  description = "Apply changes immediately to ElastiCache"
  type        = bool
  default     = false
}

variable "elasticache_automatic_failover" {
  description = "Enable automatic failover for ElastiCache"
  type        = bool
  default     = true
}

variable "elasticache_multi_az" {
  description = "Enable Multi-AZ for ElastiCache"
  type        = bool
  default     = true
}

# ---------------------------------------------------------------------------
# S3 Bucket Variables
# ---------------------------------------------------------------------------
variable "s3_bucket_name" {
  description = "Name of the S3 bucket for content storage"
  type        = string
  default     = "autoblog-ai-content"
}

variable "s3_versioning_enabled" {
  description = "Enable versioning on the S3 bucket"
  type        = bool
  default     = true
}

variable "s3_logging_bucket" {
  description = "Name of the S3 bucket for access logging"
  type        = string
  default     = "autoblog-ai-logs"
}

# ---------------------------------------------------------------------------
# CloudFront CDN Variables
# ---------------------------------------------------------------------------
variable "cloudfront_price_class" {
  description = "CloudFront price class"
  type        = string
  default     = "PriceClass_100"
  validation {
    condition     = contains(["PriceClass_100", "PriceClass_200", "PriceClass_All"], var.cloudfront_price_class)
    error_message = "Price class must be PriceClass_100, PriceClass_200, or PriceClass_All."
  }
}

variable "cloudfront_default_ttl" {
  description = "Default TTL in seconds for CloudFront"
  type        = number
  default     = 3600
}

variable "cloudfront_max_ttl" {
  description = "Maximum TTL in seconds for CloudFront"
  type        = number
  default     = 86400
}

variable "cloudfront_min_ttl" {
  description = "Minimum TTL in seconds for CloudFront"
  type        = number
  default     = 0
}

variable "cloudfront_aliases" {
  description = "Alternate domain names (CNAMEs) for CloudFront"
  type        = list(string)
  default     = ["autoblog.ai", "www.autoblog.ai", "cdn.autoblog.ai"]
}

variable "cloudfront_certificate_arn" {
  description = "ARN of the ACM certificate for CloudFront (must be in us-east-1)"
  type        = string
  default     = ""
}

variable "cloudfront_web_acl_id" {
  description = "WAF Web ACL ID for CloudFront"
  type        = string
  default     = null
}

# ---------------------------------------------------------------------------
# Route53 Variables
# ---------------------------------------------------------------------------
variable "route53_zone_name" {
  description = "Name of the Route53 hosted zone"
  type        = string
  default     = "autoblog.ai"
}

variable "route53_zone_id" {
  description = "ID of an existing Route53 hosted zone (or create one)"
  type        = string
  default     = ""
}

variable "route53_create_zone" {
  description = "Create a new Route53 hosted zone"
  type        = bool
  default     = true
}

# ---------------------------------------------------------------------------
# ACM Certificate Variables
# ---------------------------------------------------------------------------
variable "acm_certificate_domain" {
  description = "Domain name for the ACM certificate"
  type        = string
  default     = "*.autoblog.ai"
}

variable "acm_certificate_alternative_names" {
  description = "Alternative domain names for the ACM certificate"
  type        = list(string)
  default     = ["autoblog.ai"]
}

# ---------------------------------------------------------------------------
# Secrets Manager Variables
# ---------------------------------------------------------------------------
variable "secrets_manager_rotation_days" {
  description = "Number of days for Secrets Manager rotation"
  type        = number
  default     = 90
}

# ---------------------------------------------------------------------------
# Monitoring and Logging Variables
# ---------------------------------------------------------------------------
variable "log_retention_days" {
  description = "Number of days to retain CloudWatch logs"
  type        = number
  default     = 90
}

variable "enable_detailed_monitoring" {
  description = "Enable detailed monitoring for EC2/RDS"
  type        = bool
  default     = false
}
