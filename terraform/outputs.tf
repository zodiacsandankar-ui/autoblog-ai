# =============================================================================
# Terraform Outputs - AutoBlog AI
# =============================================================================

output "vpc_id" {
  description = "ID of the VPC"
  value       = module.vpc.vpc_id
}

output "vpc_private_subnets" {
  description = "List of private subnet IDs"
  value       = module.vpc.private_subnets
}

output "vpc_public_subnets" {
  description = "List of public subnet IDs"
  value       = module.vpc.public_subnets
}

output "vpc_database_subnets" {
  description = "List of database subnet IDs"
  value       = module.vpc.database_subnets
}

output "vpc_database_subnet_group" {
  description = "Name of the database subnet group"
  value       = module.vpc.database_subnet_group_name
}

output "eks_cluster_id" {
  description = "ID of the EKS cluster"
  value       = module.eks_cluster.cluster_id
}

output "eks_cluster_name" {
  description = "Name of the EKS cluster"
  value       = module.eks_cluster.cluster_name
}

output "eks_cluster_endpoint" {
  description = "Endpoint URL of the EKS cluster API server"
  value       = module.eks_cluster.cluster_endpoint
  sensitive   = true
}

output "eks_cluster_arn" {
  description = "ARN of the EKS cluster"
  value       = module.eks_cluster.cluster_arn
}

output "eks_cluster_security_group_id" {
  description = "Security group ID of the EKS cluster"
  value       = module.eks_cluster.cluster_security_group_id
}

output "eks_node_group_arn" {
  description = "ARN of the EKS node group"
  value       = module.eks_node_group.node_group_arn
}

output "eks_oidc_provider_arn" {
  description = "ARN of the EKS OIDC provider"
  value       = module.eks_cluster.oidc_provider_arn
}

output "eks_oidc_provider_url" {
  description = "URL of the EKS OIDC provider"
  value       = module.eks_cluster.oidc_provider
}

output "kubeconfig_command" {
  description = "Command to generate kubeconfig"
  value       = "aws eks update-kubeconfig --region ${var.aws_region} --name ${module.eks_cluster.cluster_name}"
}

output "rds_endpoint" {
  description = "Endpoint address of the RDS PostgreSQL instance"
  value       = module.rds_postgres.db_instance_endpoint
  sensitive   = true
}

output "rds_port" {
  description = "Port of the RDS PostgreSQL instance"
  value       = module.rds_postgres.db_instance_port
}

output "rds_database_name" {
  description = "Name of the PostgreSQL database"
  value       = module.rds_postgres.db_instance_name
}

output "rds_master_username" {
  description = "Master username of the RDS instance"
  value       = module.rds_postgres.db_instance_username
  sensitive   = true
}

output "rds_arn" {
  description = "ARN of the RDS instance"
  value       = module.rds_postgres.db_instance_arn
}

output "rds_connection_string" {
  description = "JDBC connection string for RDS"
  value       = "postgresql://${var.rds_database_username}:****@${module.rds_postgres.db_instance_endpoint}:${module.rds_postgres.db_instance_port}/${module.rds_postgres.db_instance_name}"
  sensitive   = true
}

output "elasticache_endpoint" {
  description = "Endpoint of the ElastiCache Redis cluster"
  value       = module.elasticache_redis.replication_group_primary_endpoint_address
  sensitive   = true
}

output "elasticache_port" {
  description = "Port of the ElastiCache Redis cluster"
  value       = module.elasticache_redis.replication_group_port
}

output "elasticache_reader_endpoint" {
  description = "Reader endpoint of the ElastiCache Redis cluster"
  value       = module.elasticache_redis.replication_group_reader_endpoint_address
  sensitive   = true
}

output "s3_content_bucket_id" {
  description = "ID of the S3 content storage bucket"
  value       = module.s3_content_bucket.s3_bucket_id
}

output "s3_content_bucket_arn" {
  description = "ARN of the S3 content storage bucket"
  value       = module.s3_content_bucket.s3_bucket_arn
}

output "s3_logging_bucket_id" {
  description = "ID of the S3 logging bucket"
  value       = module.s3_logging_bucket.s3_bucket_id
}

output "cloudfront_distribution_id" {
  description = "ID of the CloudFront distribution"
  value       = module.cloudfront_cdn.cloudfront_distribution_id
}

output "cloudfront_distribution_domain" {
  description = "Domain name of the CloudFront distribution"
  value       = module.cloudfront_cdn.cloudfront_distribution_domain_name
}

output "route53_zone_id" {
  description = "ID of the Route53 hosted zone"
  value       = module.route53.zone_id
}

output "route53_zone_name" {
  description = "Name of the Route53 hosted zone"
  value       = module.route53.zone_name
}

output "route53_nameservers" {
  description = "Nameservers of the Route53 hosted zone"
  value       = module.route53.name_servers
}

output "acm_certificate_arn" {
  description = "ARN of the ACM certificate"
  value       = module.acm_certificate.acm_certificate_arn
}

output "secrets_manager_db_secret_arn" {
  description = "ARN of the database secret"
  value       = module.secrets.db_secret_arn
}

output "secrets_manager_api_secret_arn" {
  description = "ARN of the API secret"
  value       = module.secrets.api_secret_arn
}

output "nat_gateway_ips" {
  description = "Elastic IPs of the NAT gateways"
  value       = module.vpc.nat_public_ips
}

output "cloudwatch_log_groups" {
  description = "CloudWatch log group names"
  value = {
    eks_control_plane = module.eks_cluster.cloudwatch_log_group_name
  }
}

output "connection_summary" {
  description = "Summary of connection strings"
  value = {
    environment          = var.environment
    region               = var.aws_region
    eks_cluster          = module.eks_cluster.cluster_name
    rds_endpoint         = module.rds_postgres.db_instance_endpoint
    elasticache_endpoint = module.elasticache_redis.replication_group_primary_endpoint_address
    s3_bucket            = module.s3_content_bucket.s3_bucket_id
    cloudfront_domain    = module.cloudfront_cdn.cloudfront_distribution_domain_name
    route53_zone         = module.route53.zone_name
  }
}
