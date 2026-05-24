export interface RetryConfig {
  maxAttempts: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  jitter?: boolean;
}

export type RetryCallback<T> = () => Promise<T>;

// Circuit Breaker states
type CircuitState = 'closed' | 'open' | 'half-open';

export class RetryService {
  private config: Required<RetryConfig>;
  private attempts = 0;
  private circuitState: CircuitState = 'closed';
  private circuitFailures = 0;
  private circuitLastFailure = 0;
  private readonly CIRCUIT_THRESHOLD = 5;
  private readonly CIRCUIT_TIMEOUT = 60_000; // 60s

  constructor(config: RetryConfig) {
    this.config = { jitter: true, ...config };
  }

  async execute<T>(callback: RetryCallback<T>): Promise<T> {
    if (this.isCircuitOpen()) {
      throw new Error('Circuit breaker OPEN — serviço indisponível temporariamente');
    }

    for (let attempt = 1; attempt <= this.config.maxAttempts; attempt++) {
      this.attempts = attempt;
      try {
        const result = await callback();
        this.onSuccess();
        return result;
      } catch (error) {
        const isLast = attempt === this.config.maxAttempts;
        if (isLast) {
          this.onFailure();
          throw error;
        }
        const delay = this.calculateDelay(attempt);
        await this.sleep(delay);
      }
    }

    throw new Error('RetryService: max attempts reached');
  }

  // Retry com callback de progresso
  async executeWithProgress<T>(
    callback: RetryCallback<T>,
    onRetry: (attempt: number, delay: number) => void
  ): Promise<T> {
    for (let attempt = 1; attempt <= this.config.maxAttempts; attempt++) {
      try {
        return await callback();
      } catch (error) {
        if (attempt === this.config.maxAttempts) throw error;
        const delay = this.calculateDelay(attempt);
        onRetry(attempt, delay);
        await this.sleep(delay);
      }
    }
    throw new Error('RetryService: max attempts reached');
  }

  private calculateDelay(attempt: number): number {
    const base = this.config.initialDelay * Math.pow(this.config.backoffMultiplier, attempt - 1);
    const capped = Math.min(base, this.config.maxDelay);
    if (!this.config.jitter) return capped;
    // Jitter aleatório para evitar thundering herd
    return capped * (0.5 + Math.random() * 0.5);
  }

  private isCircuitOpen(): boolean {
    if (this.circuitState === 'open') {
      const elapsed = Date.now() - this.circuitLastFailure;
      if (elapsed >= this.CIRCUIT_TIMEOUT) {
        this.circuitState = 'half-open';
        return false;
      }
      return true;
    }
    return false;
  }

  private onSuccess(): void {
    this.circuitFailures = 0;
    this.circuitState = 'closed';
  }

  private onFailure(): void {
    this.circuitFailures++;
    this.circuitLastFailure = Date.now();
    if (this.circuitFailures >= this.CIRCUIT_THRESHOLD) {
      this.circuitState = 'open';
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  reset(): void {
    this.attempts = 0;
  }

  getAttempts(): number { return this.attempts; }
  getCircuitState(): CircuitState { return this.circuitState; }
}
