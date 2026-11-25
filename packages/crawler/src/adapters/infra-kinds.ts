/** Cloud resource types (Terraform, CloudFormation, CDK constructs) → node kind + layer + label. */
import type { NodeKind } from '../../../schema/src/index.ts';

export interface InfraKind { kind: NodeKind; layer: string; label: string; tags: string[]; /** plumbing: never a node, maybe an edge */ skip?: boolean }

const K = (kind: NodeKind, layer: string, label: string, ...tags: string[]): InfraKind => ({ kind, layer, label, tags });

/** Terraform resource type → kind. Longest-prefix match on the rules below. */
const TF: [RegExp, InfraKind][] = [
  [/^aws_dynamodb_table$/, K('table', 'persistence', 'DynamoDB table', 'aws', 'dynamodb')],
  [/^aws_s3_bucket$/, K('store', 'persistence', 'S3 bucket', 'aws', 's3')],
  [/^aws_(db_instance|rds_cluster|rds_cluster_instance|docdb_cluster|neptune_cluster|redshift_cluster|timestreamwrite_database|efs_file_system|opensearch_domain|elasticsearch_domain|keyspaces_keyspace|qldb_ledger)$/, K('store', 'persistence', 'database', 'aws')],
  [/^aws_(elasticache_cluster|elasticache_replication_group|elasticache_serverless_cache|memorydb_cluster)$/, K('cache', 'persistence', 'cache', 'aws', 'redis')],
  [/^aws_(sqs_queue|sns_topic|kinesis_stream|kinesis_firehose_delivery_stream|msk_cluster|mq_broker)$/, K('queue', 'domain', 'queue', 'aws')],
  [/^aws_(cloudwatch_event_rule|cloudwatch_event_bus|scheduler_schedule)$/, K('event', 'domain', 'event rule', 'aws', 'eventbridge')],
  [/^aws_lambda_function$/, K('function', 'domain', 'Lambda', 'aws', 'lambda')],
  [/^aws_(sfn_state_machine|glue_job|batch_job_definition|codebuild_project)$/, K('job', 'domain', 'job', 'aws')],
  [/^aws_(ecs_service|ecs_task_definition|apprunner_service|elastic_beanstalk_environment|instance|eks_cluster|ecs_cluster|lightsail_instance|amplify_app)$/, K('app', 'domain', 'service', 'aws')],
  [/^aws_(apigatewayv2_api|api_gateway_rest_api|appsync_graphql_api|lb|alb|elb|lambda_function_url|cloudfront_function)$/, K('route', 'api', 'API', 'aws')],
  [/^aws_(apigatewayv2_route|api_gateway_resource|api_gateway_method)$/, K('route', 'api', 'route', 'aws')],
  [/^aws_(cloudfront_distribution|wafv2_web_acl|waf_web_acl|globalaccelerator_accelerator)$/, K('middleware', 'edge', 'edge', 'aws')],
  [/^aws_(cognito_user_pool|ses_domain_identity|ses_email_identity|pinpoint_app|location_map|bedrock_agent|sagemaker_endpoint|connect_instance)$/, K('external', 'external', 'managed service', 'aws')],
  [/^aws_(secretsmanager_secret|ssm_parameter|kms_key|acm_certificate|route53_zone|route53_record)$/, K('config', 'edge', 'config', 'aws')],
  [/^google_(bigtable_table|bigquery_table|spanner_database|firestore_database)$/, K('table', 'persistence', 'table', 'gcp')],
  [/^google_(storage_bucket|sql_database_instance|sql_database|spanner_instance|bigquery_dataset|filestore_instance)$/, K('store', 'persistence', 'store', 'gcp')],
  [/^google_(redis_instance|memcache_instance)$/, K('cache', 'persistence', 'cache', 'gcp')],
  [/^google_(pubsub_topic|pubsub_subscription|cloud_tasks_queue)$/, K('queue', 'domain', 'queue', 'gcp')],
  [/^google_(eventarc_trigger|cloud_scheduler_job)$/, K('event', 'domain', 'trigger', 'gcp')],
  [/^google_(cloudfunctions_function|cloudfunctions2_function)$/, K('function', 'domain', 'Cloud Function', 'gcp')],
  [/^google_(cloud_run_service|cloud_run_v2_service|cloud_run_v2_job|container_cluster|compute_instance|app_engine_application|app_engine_standard_app_version)$/, K('app', 'domain', 'service', 'gcp')],
  [/^google_(api_gateway_api|compute_url_map|compute_backend_service)$/, K('route', 'api', 'API', 'gcp')],
  [/^google_(compute_global_forwarding_rule|compute_security_policy|compute_ssl_certificate)$/, K('middleware', 'edge', 'edge', 'gcp')],
  [/^google_(secret_manager_secret|dns_managed_zone|dns_record_set)$/, K('config', 'edge', 'config', 'gcp')],
  [/^azurerm_(cosmosdb_sql_container|cosmosdb_mongo_collection|storage_table)$/, K('table', 'persistence', 'table', 'azure')],
  [/^azurerm_(storage_account|storage_container|cosmosdb_account|postgresql_server|postgresql_flexible_server|mssql_server|mssql_database|mysql_flexible_server|data_factory)$/, K('store', 'persistence', 'store', 'azure')],
  [/^azurerm_redis_cache$/, K('cache', 'persistence', 'cache', 'azure', 'redis')],
  [/^azurerm_(servicebus_queue|servicebus_topic|servicebus_namespace|eventhub|eventhub_namespace|storage_queue)$/, K('queue', 'domain', 'queue', 'azure')],
  [/^azurerm_eventgrid_(topic|system_topic|event_subscription)$/, K('event', 'domain', 'event', 'azure')],
  [/^azurerm_(function_app|linux_function_app|windows_function_app|logic_app_workflow)$/, K('function', 'domain', 'Function App', 'azure')],
  [/^azurerm_(container_app|linux_web_app|windows_web_app|app_service|kubernetes_cluster|container_group|virtual_machine|linux_virtual_machine|static_web_app|static_site)$/, K('app', 'domain', 'service', 'azure')],
  [/^azurerm_(api_management|api_management_api|application_gateway)$/, K('route', 'api', 'API', 'azure')],
  [/^azurerm_(cdn_profile|cdn_endpoint|frontdoor|cdn_frontdoor_profile|web_application_firewall_policy)$/, K('middleware', 'edge', 'edge', 'azure')],
  [/^azurerm_(key_vault|key_vault_secret|dns_zone)$/, K('config', 'edge', 'config', 'azure')],
  [/^cloudflare_d1_database$/, K('store', 'persistence', 'D1', 'cloudflare')],
  [/^cloudflare_(r2_bucket|workers_kv_namespace|workers_kv)$/, K('store', 'persistence', 'store', 'cloudflare')],
  [/^cloudflare_queue$/, K('queue', 'domain', 'queue', 'cloudflare')],
  [/^cloudflare_(worker_script|workers_script|worker_cron_trigger)$/, K('function', 'domain', 'Worker', 'cloudflare')],
  [/^cloudflare_pages_project$/, K('app', 'client', 'Pages project', 'cloudflare')],
  [/^cloudflare_(ruleset|zone_settings_override|access_application|page_rule|load_balancer)$/, K('middleware', 'edge', 'edge', 'cloudflare')],
  [/^vercel_project$/, K('app', 'client', 'Vercel project', 'vercel')],
  [/^(kubernetes_deployment|kubernetes_stateful_set|kubernetes_deployment_v1|kubernetes_cron_job|kubernetes_job|helm_release)$/, K('app', 'domain', 'workload', 'kubernetes')],
  [/^kubernetes_(ingress|ingress_v1)$/, K('middleware', 'edge', 'ingress', 'kubernetes')],
  [/^(upstash_redis_database)$/, K('cache', 'persistence', 'Redis', 'upstash')],
  [/^(upstash_kafka_topic|upstash_qstash)/, K('queue', 'domain', 'queue', 'upstash')],
  [/^(mongodbatlas_cluster|mongodbatlas_advanced_cluster|neon_project|neon_branch|planetscale_database|supabase_project|turso_database|snowflake_database|databricks_)/, K('store', 'persistence', 'database', 'saas')],
  [/^(stripe_|github_|datadog_|pagerduty_|auth0_|okta_|sentry_|twilio_|sendgrid_|slack_|launchdarkly_)/, K('external', 'external', 'SaaS', 'saas')],
];

/** Generic fallback by keyword so unknown providers still land somewhere sensible. */
function byKeyword(type: string): InfraKind | undefined {
  const t = type.toLowerCase();
  if (/(_|^)(table|collection)$/.test(t)) return K('table', 'persistence', 'table');
  if (/bucket|database|db_|sql|storage|volume|disk|filesystem|warehouse/.test(t)) return K('store', 'persistence', 'store');
  if (/cache|redis|memcache/.test(t)) return K('cache', 'persistence', 'cache');
  if (/queue|topic|stream|pubsub|kafka|bus$/.test(t)) return K('queue', 'domain', 'queue');
  if (/schedule|cron|event_rule|trigger/.test(t)) return K('event', 'domain', 'trigger');
  if (/function|lambda|worker/.test(t)) return K('function', 'domain', 'function');
  if (/service|app$|container|deployment|instance$|cluster$/.test(t)) return K('app', 'domain', 'service');
  if (/gateway|api$|load_balancer|_lb$/.test(t)) return K('route', 'api', 'API');
  if (/cdn|firewall|waf|distribution|dns|certificate|zone/.test(t)) return K('middleware', 'edge', 'edge');
  if (/secret|parameter|key$|config/.test(t)) return K('config', 'edge', 'config');
  return undefined;
}

export function tfKind(type: string): InfraKind | undefined {
  for (const [re, k] of TF) if (re.test(type)) return k;
  return byKeyword(type);
}

/** CloudFormation / SAM resource Type → kind. */
export function cfnKind(type: string): InfraKind | undefined {
  const map: [RegExp, InfraKind][] = [
    [/^AWS::(DynamoDB::Table|Serverless::SimpleTable|DynamoDB::GlobalTable)$/, K('table', 'persistence', 'DynamoDB table', 'aws', 'dynamodb')],
    [/^AWS::S3::Bucket$/, K('store', 'persistence', 'S3 bucket', 'aws', 's3')],
    [/^AWS::(RDS::DBInstance|RDS::DBCluster|DocDB::DBCluster|Neptune::DBCluster|Redshift::Cluster|EFS::FileSystem|OpenSearchService::Domain|Timestream::Database)$/, K('store', 'persistence', 'database', 'aws')],
    [/^AWS::(ElastiCache::|MemoryDB::)/, K('cache', 'persistence', 'cache', 'aws', 'redis')],
    [/^AWS::(SQS::Queue|SNS::Topic|Kinesis::Stream|KinesisFirehose::DeliveryStream|MSK::Cluster|AmazonMQ::Broker)$/, K('queue', 'domain', 'queue', 'aws')],
    [/^AWS::(Events::Rule|Events::EventBus|Scheduler::Schedule)$/, K('event', 'domain', 'event rule', 'aws', 'eventbridge')],
    [/^AWS::(Lambda::Function|Serverless::Function)$/, K('function', 'domain', 'Lambda', 'aws', 'lambda')],
    [/^AWS::(StepFunctions::StateMachine|Serverless::StateMachine|Glue::Job|Batch::JobDefinition)$/, K('job', 'domain', 'job', 'aws')],
    [/^AWS::(ECS::Service|ECS::TaskDefinition|AppRunner::Service|EC2::Instance|EKS::Cluster|ECS::Cluster|Amplify::App|ElasticBeanstalk::Environment)$/, K('app', 'domain', 'service', 'aws')],
    [/^AWS::(Serverless::Api|Serverless::HttpApi|ApiGateway::RestApi|ApiGatewayV2::Api|AppSync::GraphQLApi|ElasticLoadBalancingV2::LoadBalancer|Serverless::GraphQLApi)$/, K('route', 'api', 'API', 'aws')],
    [/^AWS::(ApiGateway::Resource|ApiGateway::Method|ApiGatewayV2::Route)$/, K('route', 'api', 'route', 'aws')],
    [/^AWS::(CloudFront::Distribution|WAFv2::WebACL|CloudFront::Function)$/, K('middleware', 'edge', 'edge', 'aws')],
    [/^AWS::(Cognito::UserPool|SES::|Pinpoint::|Bedrock::|SageMaker::Endpoint|Location::)/, K('external', 'external', 'managed service', 'aws')],
    [/^AWS::(SecretsManager::Secret|SSM::Parameter|KMS::Key|CertificateManager::Certificate|Route53::)/, K('config', 'edge', 'config', 'aws')],
    [/^AWS::(IAM::|EC2::(VPC|Subnet|SecurityGroup|RouteTable|InternetGateway|NatGateway)|Logs::|Lambda::(Permission|Version|Alias|LayerVersion)|CloudWatch::|ApiGateway::(Deployment|Stage)|ApiGatewayV2::(Stage|Integration|Deployment)|SNS::Subscription|Lambda::EventSourceMapping|S3::BucketPolicy|SQS::QueuePolicy|SNS::TopicPolicy|Events::|Serverless::LayerVersion|CDK::Metadata)/, { ...K('other', 'domain', 'plumbing'), skip: true }],
  ];
  for (const [re, k] of map) if (re.test(type)) return k;
  if (type.startsWith('Custom::')) return K('other', 'domain', 'custom resource', 'aws');
  return byKeyword(type.replace(/::/g, '_'));
}

/** CDK construct class name → kind (aws-cdk-lib v2 L2 and common L3 constructs). */
export function cdkKind(cls: string): InfraKind | undefined {
  const map: [RegExp, InfraKind][] = [
    [/^(Table|TableV2|CfnTable|GlobalTable)$/, K('table', 'persistence', 'DynamoDB table', 'aws', 'dynamodb')],
    [/^(Bucket|CfnBucket)$/, K('store', 'persistence', 'S3 bucket', 'aws', 's3')],
    [/^(DatabaseInstance|DatabaseCluster|ServerlessCluster|DatabaseInstanceFromSnapshot|CfnDBInstance|CfnDBCluster|FileSystem|Domain|CfnDomain)$/, K('store', 'persistence', 'database', 'aws')],
    [/^(CfnCacheCluster|CfnReplicationGroup|CfnServerlessCache|CfnCluster)$/, K('cache', 'persistence', 'cache', 'aws', 'redis')],
    [/^(Queue|Topic|Stream|CfnQueue|CfnTopic|CfnStream|DeliveryStream)$/, K('queue', 'domain', 'queue', 'aws')],
    [/^(Rule|EventBus|CfnRule|CfnSchedule|Schedule)$/, K('event', 'domain', 'event rule', 'aws', 'eventbridge')],
    [/^(Function|NodejsFunction|PythonFunction|GoFunction|DockerImageFunction|SingletonFunction|CfnFunction|EdgeFunction|RustFunction)$/, K('function', 'domain', 'Lambda', 'aws', 'lambda')],
    [/^(StateMachine|CfnStateMachine|CfnJob|JobDefinition|EcsJobDefinition)$/, K('job', 'domain', 'job', 'aws')],
    [/^(FargateService|Ec2Service|ApplicationLoadBalancedFargateService|ApplicationLoadBalancedEc2Service|NetworkLoadBalancedFargateService|QueueProcessingFargateService|ScheduledFargateTask|Cluster|Service|CfnService|Instance|AutoScalingGroup|App|Branch|FargateTaskDefinition|Ec2TaskDefinition|TaskDefinition|ContainerImage)$/, K('app', 'domain', 'service', 'aws')],
    [/^(RestApi|LambdaRestApi|SpecRestApi|HttpApi|WebSocketApi|GraphqlApi|CfnGraphQLApi|CfnApi|ApplicationLoadBalancer|NetworkLoadBalancer|FunctionUrl)$/, K('route', 'api', 'API', 'aws')],
    [/^(Distribution|CloudFrontWebDistribution|CfnDistribution|CfnWebACL)$/, K('middleware', 'edge', 'edge', 'aws')],
    [/^(UserPool|UserPoolClient|CfnUserPool|EmailIdentity|CfnIdentityPool)$/, K('external', 'external', 'managed service', 'aws')],
    [/^(Secret|StringParameter|Key|Certificate|DnsValidatedCertificate|HostedZone|ARecord|CnameRecord|PublicHostedZone)$/, K('config', 'edge', 'config', 'aws')],
    [/^(Vpc|Role|Policy|PolicyStatement|ManagedPolicy|SecurityGroup|LogGroup|Subnet|LayerVersion|Alias|Version|Stage|Deployment|CfnOutput|CfnParameter|Stack|NestedStack|Construct|Duration|RemovalPolicy|Code|Runtime|AssetCode|Metric|Alarm|Dashboard|OriginAccessIdentity|BucketDeployment|Source|CfnPermission|LambdaIntegration|HttpLambdaIntegration|LambdaSubscription|SqsSubscription|SqsEventSource|DynamoEventSource|S3EventSource|SnsEventSource|KinesisEventSource|LambdaFunction|SfnStateMachine|SqsQueue|SnsTopic|EventBridge)$/, { ...K('other', 'domain', 'plumbing'), skip: true }],
  ];
  for (const [re, k] of map) if (re.test(cls)) return k;
  return undefined;
}
