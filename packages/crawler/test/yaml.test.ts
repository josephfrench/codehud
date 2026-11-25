import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseYaml, refsIn } from '../src/yaml.ts';

test('parseYaml: block maps, sequences, inline flow, scalars, comments, block scalars', () => {
  const doc = parseYaml(`
# comment
service: orders   # trailing
provider:
  name: aws
  runtime: nodejs20.x
  tags: { team: core, env: "prod" }
  regions: [us-east-1, eu-west-1]
functions:
  create:
    handler: src/create.main
    events:
      - httpApi: 'POST /orders'
      - sqs:
          arn: !GetAtt Q.Arn
          batchSize: 10
  description: |
    multi
    line
  empty:
  flag: true
  n: 42
`);
  assert.deepEqual(doc, {
    service: 'orders',
    provider: { name: 'aws', runtime: 'nodejs20.x', tags: { team: 'core', env: 'prod' }, regions: ['us-east-1', 'eu-west-1'] },
    functions: {
      create: { handler: 'src/create.main', events: [{ httpApi: 'POST /orders' }, { sqs: { arn: { 'Fn::GetAtt': ['Q', 'Arn'] }, batchSize: 10 } }] },
      description: 'multi\nline',
      empty: null,
      flag: true,
      n: 42,
    },
  });
});

test('parseYaml: CloudFormation tags and refsIn', () => {
  const doc = parseYaml(`
Resources:
  Fn:
    Type: AWS::Serverless::Function
    Properties:
      Environment:
        Variables:
          TABLE: !Ref Table
          URL: !Sub "https://\${Api}.execute-api.\${AWS::Region}.amazonaws.com"
          ARN: !GetAtt Queue.Arn
      Policies:
        - DynamoDBCrudPolicy:
            TableName: !Ref Table
`) as any;
  const env = doc.Resources.Fn.Properties.Environment.Variables;
  assert.deepEqual(env.TABLE, { Ref: 'Table' });
  assert.deepEqual(env.ARN, { 'Fn::GetAtt': ['Queue', 'Arn'] });
  assert.deepEqual([...refsIn(env)].sort(), ['Api', 'Queue', 'Table']);
  assert.deepEqual([...refsIn(doc.Resources.Fn.Properties.Policies)], ['Table']);
});

test('parseYaml never throws on odd input', () => {
  for (const s of ['', '---', 'just a string', '- a\n- b', 'a: [1, 2', 'k: {a: b', '\t\tweird']) assert.doesNotThrow(() => parseYaml(s));
  assert.deepEqual(parseYaml('- a\n- b'), ['a', 'b']);
});
