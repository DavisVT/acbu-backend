import { assertQueueWithDLQ } from '../../config/rabbitmq';
import { logger } from '../../config/logger';
import { publishValidatedMessage } from '../../utils/rabbitmq-validation';

export abstract class BaseProducer<T> {
  protected abstract queue: string;
  protected abstract validate(payload: T): T;

  async publish(payload: T, options?: { persistent?: boolean; priority?: number }): Promise<void> {
    try {
      // Ensure queue exists with DLQ
      await assertQueueWithDLQ(this.queue);

      // Validate and publish
      const validatedPayload = this.validate(payload);
      await publishValidatedMessage(this.queue, validatedPayload, options);

      logger.debug('Message published successfully', {
        queue: this.queue,
        payload: validatedPayload,
      });
    } catch (error) {
      logger.error('Failed to publish message', {
        queue: this.queue,
        error: error instanceof Error ? error.message : String(error),
        payload,
      });
      throw error;
    }
  }
}