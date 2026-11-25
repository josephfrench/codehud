resource "aws_dynamodb_table" "orders" {
  name         = "orders"
  hash_key     = "pk"
  range_key    = "sk"
  attribute {
    name = "pk"
    type = "S"
  }
  attribute {
    name = "sk"
    type = "S"
  }
}

resource "aws_sqs_queue" "orders" {
  name = "orders-queue"
}

resource "aws_s3_bucket" "uploads" {
  bucket = "acme-uploads"
}

resource "aws_lambda_function" "create_order" {
  function_name = "create-order"
  handler       = "handler.create"
  runtime       = "nodejs20.x"
  role          = aws_iam_role.lambda.arn
  environment {
    variables = {
      ORDERS_TABLE = aws_dynamodb_table.orders.name
      QUEUE_URL    = aws_sqs_queue.orders.url
    }
  }
}

resource "aws_lambda_function" "process_order" {
  function_name = "process-order"
  handler       = "process.main"
  runtime       = "nodejs20.x"
  role          = aws_iam_role.lambda.arn
  environment {
    variables = {
      ORDERS_TABLE = aws_dynamodb_table.orders.name
    }
  }
}

resource "aws_lambda_event_source_mapping" "process" {
  event_source_arn = aws_sqs_queue.orders.arn
  function_name    = aws_lambda_function.process_order.arn
}

resource "aws_apigatewayv2_api" "http" {
  name          = "orders-http"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "create" {
  api_id           = aws_apigatewayv2_api.http.id
  integration_type = "AWS_PROXY"
  integration_uri  = aws_lambda_function.create_order.invoke_arn
}

resource "aws_apigatewayv2_route" "create" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "POST /orders"
  target    = "integrations/${aws_apigatewayv2_integration.create.id}"
}

resource "aws_iam_role" "lambda" {
  name = "lambda"
}

resource "aws_cloudfront_distribution" "cdn" {
  enabled = true
}
