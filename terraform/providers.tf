# =============================================================================
# Terraform Providers Configuration - AutoBlog AI
# =============================================================================

terraform {
  required_version = ">= 1.7.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.31"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.15"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
    null = {
      source  = "hashicorp/null"
      version = "~> 3.2"
    }
    time = {
      source  = "hashicorp/time"
      version = "~> 0.12"
    }
  }

  backend "s3" {
    bucket         = "autoblog-ai-terraform-state"
    key            = "infrastructure/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "autoblog-ai-terraform-locks"
  }
}

# =============================================================================
# AWS Provider
# =============================================================================
provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "AutoBlog AI"
      Environment = var.environment
      ManagedBy   = "Terraform"
      Repository  = "github.com/autoblog-ai/autoblog-ai"
    }
  }
}

# =============================================================================
# Kubernetes Provider (EKS)
# =============================================================================
provider "kubernetes" {
  host                   = module.eks_cluster.cluster_endpoint
  cluster_ca_certificate = base64decode(module.eks_cluster.cluster_certificate_authority_data)
  exec {
    api_version = "client.authentication.k8s.io/v1beta1"
    command     = "aws"
    args = [
      "eks",
      "get-token",
      "--cluster-name",
      module.eks_cluster.cluster_name,
      "--region",
      var.aws_region
    ]
  }
}

# =============================================================================
# Helm Provider (EKS)
# =============================================================================
provider "helm" {
  kubernetes {
    host                   = module.eks_cluster.cluster_endpoint
    cluster_ca_certificate = base64decode(module.eks_cluster.cluster_certificate_authority_data)
    exec {
      api_version = "client.authentication.k8s.io/v1beta1"
      command     = "aws"
      args = [
        "eks",
        "get-token",
        "--cluster-name",
        module.eks_cluster.cluster_name,
        "--region",
        var.aws_region
      ]
    }
  }
}
