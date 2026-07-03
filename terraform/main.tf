# =============================================================================
# Main Terraform Configuration - AutoBlog AI
# =============================================================================
# This file provisions the complete AWS infrastructure for the AutoBlog AI
# platform including:
#   - VPC with public/private/database subnets
#   - EKS cluster for Kubernetes workloads
#   - RDS PostgreSQL for persistent data
#   - ElastiCache Redis for caching/queueing
#   - S3 buckets for content storage and logging
#   - CloudFront CDN for content delivery
#   - Route53 DNS configuration
#   - ACM certificates for TLS
#   - Secrets Manager for secure credential storage

# =============================================================================
# Data Sources
# =============================================================================
data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_caller_identity" "current" {}

data "aws_region" "current" {}

# =============================================================================
# VPC Module
# =============================================================================
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.12"

  name = "${var.project_name}-vpc"
  cidr = var.vpc_cidr

  azs             = var.vpc_availability_zones
  private_subnets = var.vpc_private_subnets
  public_subnets  = var.vpc_public_subnets
  database_subnets = var.vpc_database_subnets

  enable_nat_gateway     = var.vpc_enable_nat_gateway
  single_nat_gateway     = var.vpc_single_nat_gateway
  one_nat_gateway_per_az = var.vpc_single_nat_gateway ? false : true
  enable_vpn_gateway     = var.vpc_enable_vpn_gateway
  enable_dns_hostnames   = true
  enable_dns_support     = true

  create_database_subnet_group           = true
  create_database_subnet_route_table     = true
  create_database_internet_gateway_route = false

  # VPC Flow Logs
  enable_flow_log                      = true
  create_flow_log_cloudwatch_log_group = true
  create_flow_log_cloudwatch_iam_role  = true
  flow_log_max_aggregation_interval    = 60

  tags = var.tags
}

# =============================================================================
# EKS Cluster Module
# =============================================================================
module "eks_cluster" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.24"

  cluster_name    = var.eks_cluster_name
  cluster_version = var.eks_cluster_version

  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnets

  cluster_endpoint_public_access           = true
  cluster_endpoint_private_access          = true
  cluster_endpoint_public_access_cidrs     = ["0.0.0.0/0"]
  cluster_endpoint_private_access_cidrs    = module.vpc.private_subnets_cidr_blocks

  # Control plane logging
  cluster_enabled_log_types = ["api", "audit", "authenticator", "controllerManager", "scheduler"]
  cloudwatch_log_group_retention_in_days = var.log_retention_days

  # Cluster add-ons
  cluster_addons = {
    coredns = {
      most_recent = true
    }
    kube-proxy = {
      most_recent = true
    }
    vpc-cni = {
      most_recent = true
    }
  }

  # Self-managed node groups security group
  node_security_group_additional_rules = {
    ingress_self_all = {
      description = "Node to node all ports/protocols"
      protocol    = "-1"
      from_port   = 0
      to_port     = 0
      type        = "ingress"
      self        = true
    }
    ingress_cluster_to_node_all = {
      description = "Cluster to node all ports/protocols"
      protocol    = "-1"
      from_port   = 0
      to_port     = 0
      type        = "ingress"
      source_cluster_security_group = true
    }
    egress_all = {
      description = "Node all egress"
      protocol    = "-1"
      from_port   = 0
      to_port     = 0
      type        = "egress"
      cidr_blocks = ["0.0.0.0/0"]
      ipv6_cidr_blocks = ["::/0"]
    }
  }

  tags = var.tags
}

# =============================================================================
# EKS Node Group
# =============================================================================
module "eks_node_group" {
  source  = "terraform-aws-modules/eks/aws//modules/eks-managed-node-group"
  version = "~> 20.24"

  name            = var.eks_node_group_name
  cluster_name    = module.eks_cluster.cluster_name

  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnets

  min_size     = var.eks_node_min_size
  max_size     = var.eks_node_max_size
  desired_size = var.eks_node_desired_size

  instance_types = var.eks_node_instance_types
  disk_size      = var.eks_node_disk_size

  capacity_type = "ON_DEMAND"

  update_config = {
    max_unavailable_percentage = 33
  }

  # Enable SSH access (use Session Manager instead of key pairs)
  enable_remote_access = false

  block_device_mappings = {
    xvda = {
      device_name = "/dev/xvda"
      ebs = {
        volume_size           = var.eks_node_disk_size
        volume_type           = "gp3"
        iops                  = 3000
        throughput            = 125
        encrypted             = true
        delete_on_termination = true
      }
    }
  }

  tags = merge(var.tags, {
    "k8s.io/cluster-autoscaler/${module.eks_cluster.cluster_name}" = "owned"
    "k8s.io/cluster-autoscaler/enabled"                           = "true"
  })
}

# =============================================================================
# EKS Access Entry
# =============================================================================
resource "aws_eks_access_entry" "admin" {
  cluster_name      = module.eks_cluster.cluster_name
  principal_arn     = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/Admin"
  kubernetes_groups = ["system:masters"]
  type              = "STANDARD"
}

resource "aws_eks_access_policy_association" "admin" {
  cluster_name  = module.eks_cluster.cluster_name
  policy_arn    = "arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy"
  principal_arn = aws_eks_access_entry.admin.principal_arn

  access_scope {
    type = "cluster"
  }
}

# =============================================================================
# EKS AutoScaler IAM Role
# =============================================================================
resource "aws_iam_role" "cluster_autoscaler" {
  count = var.eks_enable_cluster_autoscaler ? 1 : 0
  name  = "${var.project_name}-cluster-autoscaler-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRoleWithWebIdentity"
        Effect = "Allow"
        Principal = {
          Federated = module.eks_cluster.oidc_provider_arn
        }
        Condition = {
          StringEquals = {
            "${module.eks_cluster.oidc_provider}:sub" : "system:serviceaccount:kube-system:cluster-autoscaler"
          }
        }
      }
    ]
  })
}

resource "aws_iam_role_policy" "cluster_autoscaler" {
  count = var.eks_enable_cluster_autoscaler ? 1 : 0
  name  = "${var.project_name}-cluster-autoscaler-policy-${var.environment}"
  role  = aws_iam_role.cluster_autoscaler[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "autoscaling:DescribeAutoScalingGroups",
          "autoscaling:DescribeAutoScalingInstances",
          "autoscaling:DescribeLaunchConfigurations",
          "autoscaling:DescribeTags",
          "autoscaling:SetDesiredCapacity",
          "autoscaling:TerminateInstanceInAutoScalingGroup",
          "ec2:DescribeInstanceTypes",
          "ec2:DescribeLaunchTemplateVersions",
          "eks:DescribeNodegroup"
        ]
        Resource = ["*"]
      }
    ]
  })
}

# =============================================================================
# RDS PostgreSQL Module
# =============================================================================
module "rds_postgres" {
  source  = "terraform-aws-modules/rds/aws"
  version = "~> 6.10"

  identifier = "${var.project_name}-postgres-${var.environment}"

  engine               = "postgres"
  engine_version        = var.rds_engine_version
  family               = "postgres16"
  major_engine_version = "16"
  instance_class        = var.rds_instance_class

  allocated_storage     = var.rds_allocated_storage
  max_allocated_storage = var.rds_max_allocated_storage
  storage_type          = var.rds_storage_type
  storage_encrypted     = true

  db_name  = var.rds_database_name
  username = var.rds_database_username
  password = var.rds_database_password
  port     = 5432

  multi_az                     = var.rds_multi_az
  db_subnet_group_name         = module.vpc.database_subnet_group_name
  vpc_security_group_ids       = [aws_security_group.rds.id]

  backup_retention_period = var.rds_backup_retention_period
  backup_window           = var.rds_backup_window
  maintenance_window      = var.rds_maintenance_window

  deletion_protection      = var.rds_deletion_protection
  skip_final_snapshot      = var.rds_skip_final_snapshot
  final_snapshot_identifier = "${var.project_name}-postgres-${var.environment}-final-${formatdate("YYYY-MM-DD-hhmm", timestamp())}"

  auto_minor_version_upgrade = true

  performance_insights_enabled          = true
  performance_insights_retention_period = 7

  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]
  create_cloudwatch_log_group     = true
  cloudwatch_log_group_retention_in_days = var.log_retention_days

  parameters = [
    {
      name  = "rds.force_ssl"
      value = "1"
    },
    {
      name  = "log_statement"
      value = "ddl"
    },
    {
      name  = "log_min_duration_statement"
      value = "1000"
    }
  ]

  tags = var.tags
}

# =============================================================================
# RDS Security Group
# =============================================================================
resource "aws_security_group" "rds" {
  name_prefix = "${var.project_name}-rds-${var.environment}-"
  description = "Security group for RDS PostgreSQL"
  vpc_id      = module.vpc.vpc_id

  ingress {
    description     = "PostgreSQL from EKS cluster"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [module.eks_cluster.cluster_security_group_id]
  }

  ingress {
    description     = "PostgreSQL from EKS nodes"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [module.eks_cluster.node_security_group_id]
  }

  egress {
    description = "All outbound traffic"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = var.tags
}

# =============================================================================
# ElastiCache Redis Module
# =============================================================================
module "elasticache_redis" {
  source  = "terraform-aws-modules/elasticache/aws"
  version = "~> 1.4"

  replication_group_name        = "${var.project_name}-redis-${var.environment}"
  replication_group_description = "AutoBlog AI Redis cache and queue"

  engine         = "redis"
  engine_version = var.elasticache_engine_version
  node_type      = var.elasticache_node_type

  parameter_group_name = var.elasticache_parameter_group_name
  port                 = var.elasticache_port

  automatic_failover_enabled = var.elasticache_automatic_failover
  multi_az_enabled           = var.elasticache_multi_az

  number_cache_clusters = var.elasticache_num_cache_nodes

  subnet_group_name        = module.vpc.database_subnet_group_name
  subnet_group_description = "Redis subnet group"
  security_group_ids       = [aws_security_group.elasticache.id]

  maintenance_window = "sun:05:00-sun:06:00"
  snapshot_window    = "03:00-04:00"
  snapshot_retention_limit = var.elasticache_snapshot_retention_limit

  at_rest_encryption_enabled  = true
  transit_encryption_enabled  = true
  auth_token                  = random_password.elasticache_auth_token.result

  apply_immediately = var.elasticache_apply_immediately

  cloudwatch_logs_exports = {
    slow_log = {
      enabled                 = true
      log_group_name          = "${var.project_name}-redis-slow-${var.environment}"
      log_group_retention_days = var.log_retention_days
    }
    engine_log = {
      enabled                 = true
      log_group_name          = "${var.project_name}-redis-engine-${var.environment}"
      log_group_retention_days = var.log_retention_days
    }
  }

  tags = var.tags
}

resource "random_password" "elasticache_auth_token" {
  length  = 32
  special = false
}

# =============================================================================
# ElastiCache Security Group
# =============================================================================
resource "aws_security_group" "elasticache" {
  name_prefix = "${var.project_name}-redis-${var.environment}-"
  description = "Security group for ElastiCache Redis"
  vpc_id      = module.vpc.vpc_id

  ingress {
    description     = "Redis from EKS cluster"
    from_port       = var.elasticache_port
    to_port         = var.elasticache_port
    protocol        = "tcp"
    security_groups = [module.eks_cluster.cluster_security_group_id]
  }

  ingress {
    description     = "Redis from EKS nodes"
    from_port       = var.elasticache_port
    to_port         = var.elasticache_port
    protocol        = "tcp"
    security_groups = [module.eks_cluster.node_security_group_id]
  }

  egress {
    description = "All outbound traffic"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = var.tags
}

# =============================================================================
# S3 Content Storage Bucket
# =============================================================================
module "s3_content_bucket" {
  source  = "terraform-aws-modules/s3-bucket/aws"
  version = "~> 4.1"

  bucket = "${var.s3_bucket_name}-${var.environment}"

  acl           = "private"
  control_object_ownership = true
  object_ownership         = "BucketOwnerEnforced"

  versioning = {
    enabled = var.s3_versioning_enabled
  }

  server_side_encryption_configuration = {
    rule = {
      apply_server_side_encryption_by_default = {
        sse_algorithm = "AES256"
      }
    }
  }

  logging = {
    target_bucket = module.s3_logging_bucket.s3_bucket_id
    target_prefix = "content-logs/"
  }

  lifecycle_rule = [
    {
      id      = "abort-incomplete-multipart-upload"
      enabled = true
      abort_incomplete_multipart_upload_days = 7
    },
    {
      id      = "expire-old-versions"
      enabled = true
      filter = {
        prefix = ""
      }
      noncurrent_version_expiration = {
        noncurrent_days = 90
      }
    }
  ]

  attach_deny_insecure_transport_policy = true
  attach_require_latest_tls_policy      = true

  cors_rule = {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "PUT", "POST", "DELETE", "HEAD"]
    allowed_origins = ["https://autoblog.ai", "https://www.autoblog.ai"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3600
  }

  tags = var.tags
}

# =============================================================================
# S3 Logging Bucket
# =============================================================================
module "s3_logging_bucket" {
  source  = "terraform-aws-modules/s3-bucket/aws"
  version = "~> 4.1"

  bucket = "${var.s3_logging_bucket}-${var.environment}"

  acl           = "log-delivery-write"
  control_object_ownership = true
  object_ownership         = "BucketOwnerPreferred"

  versioning = {
    enabled = true
  }

  server_side_encryption_configuration = {
    rule = {
      apply_server_side_encryption_by_default = {
        sse_algorithm = "AES256"
      }
    }
  }

  lifecycle_rule = [
    {
      id      = "expire-old-logs"
      enabled = true
      expiration = {
        days = 365
      }
    }
  ]

  attach_deny_insecure_transport_policy = true
  attach_require_latest_tls_policy      = true

  tags = var.tags
}

# =============================================================================
# CloudFront CDN Module
# =============================================================================
module "cloudfront_cdn" {
  source  = "terraform-aws-modules/cloudfront/aws"
  version = "~> 4.1"

  comment             = "AutoBlog AI CDN - ${var.environment}"
  enabled             = true
  is_ipv6_enabled     = true
  price_class          = var.cloudfront_price_class
  retain_on_delete    = false
  wait_for_deployment = false

  aliases = var.cloudfront_aliases

  origin = {
    s3_content = {
      domain_name           = module.s3_content_bucket.s3_bucket_bucket_domain_name
      origin_access_control = "s3"
      s3_origin_config = {
        origin_access_identity = module.s3_content_bucket.cloudfront_access_identity_path
      }
    }
  }

  default_cache_behavior = {
    target_origin_id       = "s3_content"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD", "OPTIONS"]
    cache_policy_id        = "658327ea-f89d-4fab-a63d-7e88639e58f6"
    use_forwarded_values   = false

    default_ttl = var.cloudfront_default_ttl
    max_ttl     = var.cloudfront_max_ttl
    min_ttl     = var.cloudfront_min_ttl
  }

  ordered_cache_behavior = [
    {
      path_pattern           = "/static/*"
      target_origin_id       = "s3_content"
      viewer_protocol_policy = "redirect-to-https"
      compress               = true
      allowed_methods        = ["GET", "HEAD", "OPTIONS"]
      cached_methods         = ["GET", "HEAD", "OPTIONS"]
      cache_policy_id        = "658327ea-f89d-4fab-a63d-7e88639e58f6"
      use_forwarded_values   = false
      default_ttl            = 86400
      max_ttl                = 604800
      min_ttl                = 0
    },
    {
      path_pattern           = "/images/*"
      target_origin_id       = "s3_content"
      viewer_protocol_policy = "redirect-to-https"
      compress               = true
      allowed_methods        = ["GET", "HEAD", "OPTIONS"]
      cached_methods         = ["GET", "HEAD", "OPTIONS"]
      cache_policy_id        = "658327ea-f89d-4fab-a63d-7e88639e58f6"
      use_forwarded_values   = false
      default_ttl            = 604800
      max_ttl                = 2592000
      min_ttl                = 0
    }
  ]

  viewer_certificate = {
    acm_certificate_arn = var.cloudfront_certificate_arn
    ssl_support_method  = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  custom_error_response = {
    error_404 = {
      error_code         = 404
      response_code      = 404
      response_page_path = "/404.html"
    }
    error_403 = {
      error_code         = 403
      response_code      = 200
      response_page_path = "/index.html"
    }
  }

  web_acl_id = var.cloudfront_web_acl_id

  tags = var.tags
}

# =============================================================================
# Route53 Module
# =============================================================================
module "route53" {
  source  = "terraform-aws-modules/route53/aws"
  version = "~> 3.1"

  create_zone = var.route53_create_zone
  zone_id     = var.route53_create_zone ? null : var.route53_zone_id
  zone_name   = var.route53_zone_name

  records = [
    {
      name    = ""
      type    = "A"
      alias = {
        name    = module.cloudfront_cdn.cloudfront_distribution_domain_name
        zone_id = module.cloudfront_cdn.cloudfront_distribution_hosted_zone_id
      }
    },
    {
      name    = "www"
      type    = "A"
      alias = {
        name    = module.cloudfront_cdn.cloudfront_distribution_domain_name
        zone_id = module.cloudfront_cdn.cloudfront_distribution_hosted_zone_id
      }
    },
    {
      name    = "api"
      type    = "CNAME"
      records = [module.eks_cluster.cluster_endpoint]
      ttl     = 300
    },
    {
      name    = "cdn"
      type    = "CNAME"
      records = [module.cloudfront_cdn.cloudfront_distribution_domain_name]
      ttl     = 300
    }
  ]

  tags = var.tags
}

# =============================================================================
# ACM Certificate Module
# =============================================================================
module "acm_certificate" {
  source  = "terraform-aws-modules/acm/aws"
  version = "~> 5.1"

  domain_name               = var.acm_certificate_domain
  subject_alternative_names = var.acm_certificate_alternative_names
  zone_id                   = module.route53.zone_id

  validation_method = "DNS"
  wait_for_validation = true

  tags = var.tags
}

# =============================================================================
# Secrets Manager
# =============================================================================
module "secrets" {
  source  = "terraform-aws-modules/secrets-manager/aws"
  version = "~> 1.2"

  secrets = {
    "${var.project_name}-db-${var.environment}" = {
      description             = "AutoBlog AI database credentials"
      recovery_window_in_days = 7
      secret_string = jsonencode({
        username = var.rds_database_username
        password = var.rds_database_password
        host     = module.rds_postgres.db_instance_endpoint
        port     = module.rds_postgres.db_instance_port
        dbname   = module.rds_postgres.db_instance_name
        engine   = "postgres"
        dbInstanceIdentifier = module.rds_postgres.db_instance_id
      })
    }
    "${var.project_name}-api-${var.environment}" = {
      description             = "AutoBlog AI API keys and secrets"
      recovery_window_in_days = 7
      secret_string = jsonencode({
        jwt_secret         = random_password.jwt_secret.result
        jwt_refresh_secret = random_password.jwt_refresh_secret.result
      })
    }
    "${var.project_name}-redis-${var.environment}" = {
      description             = "AutoBlog AI Redis credentials"
      recovery_window_in_days = 7
      secret_string = jsonencode({
        auth_token           = random_password.elasticache_auth_token.result
        primary_endpoint     = module.elasticache_redis.replication_group_primary_endpoint_address
        reader_endpoint      = module.elasticache_redis.replication_group_reader_endpoint_address
        port                 = module.elasticache_redis.replication_group_port
      })
    }
    "${var.project_name}-ai-${var.environment}" = {
      description             = "AutoBlog AI API key for AI provider"
      recovery_window_in_days = 7
      secret_string = jsonencode({
        api_key = ""
      })
    }
  }
}

resource "random_password" "jwt_secret" {
  length  = 64
  special = true
  override_special = "!#$%&*()-_=+[]{}<>:?"
}

resource "random_password" "jwt_refresh_secret" {
  length  = 64
  special = true
  override_special = "!#$%&*()-_=+[]{}<>:?"
}

# =============================================================================
# CloudWatch Alarms
# =============================================================================
resource "aws_cloudwatch_metric_alarm" "rds_cpu_high" {
  alarm_name          = "${var.project_name}-rds-cpu-high-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "CPUUtilization"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "RDS CPU utilization is too high"
  alarm_actions       = []  # Add SNS topic ARN

  dimensions = {
    DBInstanceIdentifier = module.rds_postgres.db_instance_id
  }
}

resource "aws_cloudwatch_metric_alarm" "rds_free_storage_low" {
  alarm_name          = "${var.project_name}-rds-free-storage-low-${var.environment}"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 3
  metric_name         = "FreeStorageSpace"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 5000000000
  alarm_description   = "RDS free storage space is low"
  alarm_actions       = []

  dimensions = {
    DBInstanceIdentifier = module.rds_postgres.db_instance_id
  }
}

resource "aws_cloudwatch_metric_alarm" "elasticache_cpu_high" {
  alarm_name          = "${var.project_name}-elasticache-cpu-high-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "CPUUtilization"
  namespace           = "AWS/ElastiCache"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "ElastiCache CPU utilization is too high"
  alarm_actions       = []

  dimensions = {
    CacheClusterId = module.elasticache_redis.replication_group_id
  }
}

resource "aws_cloudwatch_metric_alarm" "elasticache_evictions_high" {
  alarm_name          = "${var.project_name}-elasticache-evictions-high-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "Evictions"
  namespace           = "AWS/ElastiCache"
  period              = 300
  statistic           = "Sum"
  threshold           = 100
  alarm_description   = "ElastiCache evictions rate is high"
  alarm_actions       = []

  dimensions = {
    CacheClusterId = module.elasticache_redis.replication_group_id
  }
}
