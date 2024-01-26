import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as cf_origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as r53_targets from 'aws-cdk-lib/aws-route53-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ssm from 'aws-cdk-lib/aws-ssm';


export class BlogWebInfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    cdk.Tags.of(this).add('project', 'prototypinginsights.com');

    const blogDomain = ssm.StringParameter.valueForStringParameter(
      this, "/blog/domain",
    );

    const blogHostedZoneId = ssm.StringParameter.valueForStringParameter(
      this, "/blog/hostedZoneId",
    );

    const certificateArn = ssm.StringParameter.valueForStringParameter(
      this, '/blog/certificateArn',
    );

    const siteBucket = new s3.Bucket(this, "S3Bucket", {
      bucketName: blogDomain,
    });

    const loggingBucket = new s3.Bucket(this, "LoggingBucket", {
      objectOwnership: s3.ObjectOwnership.OBJECT_WRITER,
    });

    const viewerRequestFunction = new cloudfront.Function(this, "ViewerRequestFunction", {
      code: cloudfront.FunctionCode.fromFile({
        filePath: "./lib/resources/viewer-request-function.js",
      }),
      runtime: cloudfront.FunctionRuntime.JS_2_0,
    });

    const distribution = new cloudfront.Distribution(this, "Distribution", {
      defaultRootObject: "index.html",
      defaultBehavior: {
        origin: new cf_origins.S3Origin(siteBucket),
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        functionAssociations: [{
          function: viewerRequestFunction,
          eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
        }],
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        compress: true,
      },
      domainNames: [
        blogDomain,
        `www.${blogDomain}`,
      ],
      certificate: acm.Certificate.fromCertificateArn(
        this, "TlsCertificate", certificateArn
      ),
      enableLogging: true,
      logBucket: loggingBucket,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
    });

    const originAccessControl = new cloudfront.CfnOriginAccessControl(this, 'OriginAccessControl', {
      originAccessControlConfig: {
        name: "prototyping-insights-oac",
        originAccessControlOriginType: 's3',
        signingBehavior: 'always',
        signingProtocol: 'sigv4',
        description: 'Origin access control for prototypinginsights.com',
      },
    });

    // https://github.com/aws/aws-cdk/issues/21771
    const l1Distribution = distribution.node.defaultChild as cloudfront.CfnDistribution;
    l1Distribution.addPropertyOverride(
      'DistributionConfig.Origins.0.OriginAccessControlId',
      originAccessControl?.attrId,
    );
    l1Distribution.addPropertyOverride(
      'DistributionConfig.Origins.0.S3OriginConfig.OriginAccessIdentity',
      '',
    );

    siteBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          's3:GetObject',
        ],
        principals: [
          new iam.ServicePrincipal('cloudfront.amazonaws.com')
        ],
        resources: [
          siteBucket.arnForObjects('*'),
        ],
        conditions: {
          "StringEquals": {
            'AWS:SourceArn': `arn:aws:cloudfront::${cdk.Aws.ACCOUNT_ID}:distribution/${distribution.distributionId}`,
          },
        },
      }),
    );

    const blogHostedZone = route53.HostedZone.fromHostedZoneAttributes(
      this, "BlogHostedZone", {
        hostedZoneId: blogHostedZoneId,
        zoneName: blogDomain,
      },
    );

    new route53.ARecord(this, "BlogRootARecord", {
      recordName: blogDomain,
      target: route53.RecordTarget.fromAlias(
        new r53_targets.CloudFrontTarget(distribution),
      ),
      zone: blogHostedZone,
    });

    new route53.CnameRecord(this, "BlogWwwARecord", {
      domainName: blogDomain,
      recordName: `www.${blogDomain}`,
      zone: blogHostedZone,
    });
  }

  private getHttpSecurityHeadersFunction() {
    /* https://raw.githubusercontent.com/awslabs/aws-solutions-constructs/d452c0e54df83b2d12c15b298ac1241aad471ad3/source/patterns/%40aws-solutions-constructs/core/lib/cloudfront-distribution-helper.ts */
    const functionId = `SetHttpSecurityHeaders${this.node.addr}`;

    return new cloudfront.Function(this, "SetHttpSecurityHeaders", {
      functionName: functionId,
      code: cloudfront.FunctionCode.fromInline("function handler(event) { " +
        "var response = event.response; " +
        "var headers = response.headers; " +
        "headers['strict-transport-security'] = { value: 'max-age=63072000; includeSubdomains; preload'}; " +
        "headers['content-security-policy'] = { value: \"default-src 'none'; img-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'\"}; " +
        "headers['x-content-type-options'] = { value: 'nosniff'}; headers['x-frame-options'] = {value: 'DENY'}; " +
        "headers['x-xss-protection'] = {value: '1; mode=block'}; " +
        "return response; }")
    });  
  }
}
