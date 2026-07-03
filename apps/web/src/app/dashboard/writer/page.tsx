'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { useGenerateArticle } from '@/hooks/use-article';
import { Wand2, Settings, Target, FileText, Sparkles } from 'lucide-react';

export default function AIWriterPage() {
  const [topic, setTopic] = useState('');
  const [primaryKeyword, setPrimaryKeyword] = useState('');
  const [targetAudience, setTargetAudience] = useState('');
  const [tone, setTone] = useState('professional');
  const [wordCount, setWordCount] = useState('1500');
  const [language, setLanguage] = useState('en');
  const [additionalInstructions, setAdditionalInstructions] = useState('');
  const [generatedContent, setGeneratedContent] = useState<string | null>(null);
  const [streamingContent, setStreamingContent] = useState('');

  const generateMutation = useGenerateArticle();

  const handleGenerate = async () => {
    try {
      const result = await generateMutation.mutateAsync({
        topic,
        primaryKeyword,
        targetAudience,
        tone,
        targetWordCount: parseInt(wordCount),
        language,
        additionalInstructions,
        projectId: 'current',
        stream: true,
      });
      setGeneratedContent((result as any).content);
    } catch {}
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">AI Writer</h1>
        <p className="text-muted-foreground mt-1">
          Generate complete, SEO-optimized blog articles with DeepSeek AI
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="h-5 w-5" /> Article Brief
              </CardTitle>
              <CardDescription>Define what you want to write about</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="topic">Topic / Title</Label>
                <Input
                  id="topic"
                  placeholder="e.g., The Future of AI in Content Marketing"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="keyword">Primary Keyword</Label>
                <Input
                  id="keyword"
                  placeholder="e.g., AI content marketing"
                  value={primaryKeyword}
                  onChange={(e) => setPrimaryKeyword(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="audience">Target Audience</Label>
                <Input
                  id="audience"
                  placeholder="e.g., Content marketers and business owners"
                  value={targetAudience}
                  onChange={(e) => setTargetAudience(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Tone</Label>
                  <Select value={tone} onValueChange={setTone}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="professional">Professional</SelectItem>
                      <SelectItem value="conversational">Conversational</SelectItem>
                      <SelectItem value="humorous">Humorous</SelectItem>
                      <SelectItem value="authoritative">Authoritative</SelectItem>
                      <SelectItem value="empathetic">Empathetic</SelectItem>
                      <SelectItem value="technical">Technical</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Word Count</Label>
                  <Select value={wordCount} onValueChange={setWordCount}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="800">Short (~800)</SelectItem>
                      <SelectItem value="1500">Medium (~1,500)</SelectItem>
                      <SelectItem value="2500">Long (~2,500)</SelectItem>
                      <SelectItem value="4000">Comprehensive (~4,000)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Language</Label>
                <Select value={language} onValueChange={setLanguage}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="en">English</SelectItem>
                    <SelectItem value="es">Spanish</SelectItem>
                    <SelectItem value="fr">French</SelectItem>
                    <SelectItem value="de">German</SelectItem>
                    <SelectItem value="pt">Portuguese</SelectItem>
                    <SelectItem value="ja">Japanese</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="instructions">Additional Instructions</Label>
                <Textarea
                  id="instructions"
                  placeholder="Any specific requirements, must-include topics, or style preferences..."
                  value={additionalInstructions}
                  onChange={(e) => setAdditionalInstructions(e.target.value)}
                  rows={3}
                />
              </div>

              <Button
                className="w-full"
                size="lg"
                onClick={handleGenerate}
                disabled={!topic || generateMutation.isPending}
              >
                {generateMutation.isPending ? (
                  <>
                    <Sparkles className="mr-2 h-4 w-4 animate-pulse" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Wand2 className="mr-2 h-4 w-4" />
                    Generate Article
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5" /> Generation Settings
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">AI Provider</span>
                <Badge>DeepSeek V4 Pro</Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">SEO Optimization</span>
                <Badge variant="secondary">Auto</Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Image Generation</span>
                <Badge variant="secondary">Auto</Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">AI Detection Reduction</span>
                <Badge variant="secondary">Enabled</Badge>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-3">
          <Card className="min-h-[600px]">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" /> Generated Content
              </CardTitle>
              <CardDescription>
                {generatedContent
                  ? 'Your AI-generated article is ready'
                  : 'Your generated article will appear here'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {generateMutation.isPending ? (
                <div className="space-y-4 animate-pulse">
                  <div className="h-6 bg-muted rounded w-3/4" />
                  <div className="h-4 bg-muted rounded w-full" />
                  <div className="h-4 bg-muted rounded w-5/6" />
                  <div className="h-4 bg-muted rounded w-full" />
                  <div className="h-4 bg-muted rounded w-4/5" />
                  <div className="h-32 bg-muted rounded w-full mt-4" />
                  <div className="h-4 bg-muted rounded w-full" />
                  <div className="h-4 bg-muted rounded w-3/4" />
                </div>
              ) : generatedContent ? (
                <div className="prose prose-slate max-w-none dark:prose-invert">
                  <div dangerouslySetInnerHTML={{ __html: generatedContent }} />
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <Wand2 className="h-12 w-12 text-muted-foreground/30 mb-4" />
                  <h3 className="font-semibold text-lg mb-2">Ready to Write</h3>
                  <p className="text-sm text-muted-foreground max-w-sm">
                    Fill in the article brief on the left and click Generate Article to create AI-powered content.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
