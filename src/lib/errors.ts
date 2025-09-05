/**
 * Error handling utilities
 */

import { generateRequestId } from './crypto';

export function createErrorResponse(
  message: string,
  type: string,
  requestId?: string,
  _statusCode = 500
) {
  return {
    error: {
      message,
      type,
      request_id: requestId || generateRequestId(),
    },
  };
}
