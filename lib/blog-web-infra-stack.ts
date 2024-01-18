import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as cf_origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as r53_targets from 'aws-cdk-lib/aws-route53-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ssm from 'aws-cdk-lib/aws-ssm';
// import * as sqs from 'aws-cdk-lib/aws-sqs';



export class BlogWebInfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const blogDomain = ssm.StringParameter.valueForStringParameter(
      this, "/blog/domain",
    );

    const blogHostedZoneId = ssm.StringParameter.valueForStringParameter(
      this, "/blog/hostedZoneId",
    );

    const certificateArn = ssm.StringParameter.valueForStringParameter(
      this, '/blog/certificateArn',
    );

    const originAccessIdentity = new cloudfront.OriginAccessIdentity(
      this, "OriginAccessIdentity",
    );

    const s3Bucket = new s3.Bucket(this, "S3Bucket", {
      bucketName: blogDomain,
    });

    const distribution = new cloudfront.Distribution(this, "Distribution", {
      defaultRootObject: "index.html",
      defaultBehavior: {
        origin: new cf_origins.S3Origin(s3Bucket, {
          originAccessIdentity
        }),
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      domainNames: [
        blogDomain,
        `www.${blogDomain}`,
      ],
      certificate: acm.Certificate.fromCertificateArn(
        this, "TlsCertificate", certificateArn
      ),
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
    });

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
}
