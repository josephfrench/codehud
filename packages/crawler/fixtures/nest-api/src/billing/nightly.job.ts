import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
@Injectable()
export class NightlyJob { @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT) run() {} }
