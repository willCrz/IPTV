export class FailoverService {
  private urls: string[] = [];
  private currentIndex = 0;
  private failedUrls = new Set<string>();
  private lastSuccessUrl: string | null = null;

  setUrls(urls: string[]): void {
    this.urls = urls.filter(Boolean);
    this.currentIndex = 0;
    this.failedUrls.clear();
  }

  getNextUrl(): string {
    if (this.urls.length === 0) {
      throw new Error('FailoverService: nenhuma URL configurada');
    }

    // Tentar próxima URL não-falhada
    for (let i = 0; i < this.urls.length; i++) {
      const idx = (this.currentIndex + i) % this.urls.length;
      const url = this.urls[idx];
      if (!this.failedUrls.has(url)) {
        this.currentIndex = (idx + 1) % this.urls.length;
        return url;
      }
    }

    // Todas falharam — resetar e tentar de novo a partir da principal
    this.failedUrls.clear();
    this.currentIndex = 0;
    return this.urls[0];
  }

  getCurrentUrl(): string {
    return this.urls[this.currentIndex] ?? this.urls[0] ?? '';
  }

  markFailed(url: string): void {
    this.failedUrls.add(url);
  }

  markSuccess(url: string): void {
    this.lastSuccessUrl = url;
    this.failedUrls.delete(url);
  }

  hasAlternatives(): boolean {
    const available = this.urls.filter(u => !this.failedUrls.has(u));
    return available.length > 1;
  }

  reset(): void {
    this.currentIndex = 0;
    this.failedUrls.clear();
  }

  getStatus(): { total: number; failed: number; available: number; lastSuccess: string | null } {
    return {
      total: this.urls.length,
      failed: this.failedUrls.size,
      available: this.urls.length - this.failedUrls.size,
      lastSuccess: this.lastSuccessUrl,
    };
  }
}
