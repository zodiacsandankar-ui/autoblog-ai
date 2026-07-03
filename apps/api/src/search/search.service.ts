import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MeiliSearch } from 'meilisearch';

export interface SearchDocument {
  id: string;
  [key: string]: any;
}

export interface SearchOptions {
  limit?: number;
  offset?: number;
  filter?: string;
  sort?: string[];
  attributesToRetrieve?: string[];
  attributesToHighlight?: string[];
}

@Injectable()
export class SearchService {
  private readonly client: MeiliSearch;
  private readonly logger = new Logger(SearchService.name);

  constructor(private readonly configService: ConfigService) {
    const host = configService.get<string>('MEILI_HOST', 'http://localhost:7700');
    const apiKey = configService.get<string>('MEILI_MASTER_KEY', '');

    this.client = new MeiliSearch({ host, apiKey });
  }

  async indexDocuments(indexName: string, documents: SearchDocument[]): Promise<void> {
    try {
      const index = this.client.index(indexName);
      await index.addDocuments(documents, { primaryKey: 'id' });
      this.logger.debug(`Indexed ${documents.length} documents to ${indexName}`);
    } catch (error) {
      this.logger.error(`Failed to index documents to ${indexName}:`, error);
    }
  }

  async updateDocument(indexName: string, document: SearchDocument): Promise<void> {
    try {
      const index = this.client.index(indexName);
      await index.updateDocuments([document], { primaryKey: 'id' });
    } catch (error) {
      this.logger.error(`Failed to update document in ${indexName}:`, error);
    }
  }

  async deleteDocument(indexName: string, id: string): Promise<void> {
    try {
      const index = this.client.index(indexName);
      await index.deleteDocument(id);
    } catch (error) {
      this.logger.error(`Failed to delete document ${id} from ${indexName}:`, error);
    }
  }

  async deleteIndex(indexName: string): Promise<void> {
    try {
      await this.client.deleteIndex(indexName);
    } catch (error) {
      this.logger.error(`Failed to delete index ${indexName}:`, error);
    }
  }

  async search<T = any>(
    indexName: string,
    query: string,
    options: SearchOptions = {},
  ): Promise<{ hits: T[]; totalHits: number; processingTimeMs: number }> {
    try {
      const index = this.client.index(indexName);
      const results = await index.search(query, {
        limit: options.limit || 20,
        offset: options.offset || 0,
        filter: options.filter,
        sort: options.sort,
        attributesToRetrieve: options.attributesToRetrieve,
        attributesToHighlight: options.attributesToHighlight,
      });

      return {
        hits: results.hits as T[],
        totalHits: results.estimatedTotalHits || 0,
        processingTimeMs: results.processingTimeMs,
      };
    } catch (error) {
      this.logger.error(`Search failed for ${indexName}:`, error);
      return { hits: [], totalHits: 0, processingTimeMs: 0 };
    }
  }

  async configureIndex(indexName: string, settings: any): Promise<void> {
    try {
      const index = this.client.index(indexName);
      await index.updateSettings(settings);
      this.logger.debug(`Configured index ${indexName}`);
    } catch (error) {
      this.logger.error(`Failed to configure index ${indexName}:`, error);
    }
  }

  async setupArticleSearch(): Promise<void> {
    await this.configureIndex('articles', {
      searchableAttributes: ['title', 'metaDescription', 'content', 'category', 'tags'],
      filterableAttributes: ['status', 'projectId', 'category', 'tags', 'publishedAt'],
      sortableAttributes: ['publishedAt', 'createdAt', 'wordCount', 'seoScore'],
      rankingRules: ['words', 'typo', 'proximity', 'attribute', 'sort', 'exactness'],
      distinctAttribute: null,
      faceting: { maxValuesPerFacet: 100 },
    });
  }
}
