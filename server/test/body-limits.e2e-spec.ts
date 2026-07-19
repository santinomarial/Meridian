import request from 'supertest';
import type TestAgent from 'supertest/lib/agent';
import {
  cleanupByEmailPrefix,
  createTestApp,
  STRONG_PASSWORD,
  type TestApp,
  uniqueEmail,
} from './utils/test-app';

const PREFIX = 'int-body-limit-';

describe('HTTP body limits', () => {
  let testApp: TestApp;
  let agent: TestAgent;
  let workspaceId: string;

  beforeAll(async () => {
    testApp = await createTestApp();
    agent = request.agent(testApp.server);
    await agent
      .post('/auth/register')
      .send({
        email: uniqueEmail(PREFIX),
        password: STRONG_PASSWORD,
        displayName: 'Large File Tester',
      })
      .expect(201);
    const workspace = await agent
      .post('/workspaces')
      .send({ name: 'Body Limit Workspace' })
      .expect(201);
    workspaceId = workspace.body.id as string;
  });

  afterAll(async () => {
    await cleanupByEmailPrefix(testApp.prisma, PREFIX);
    await testApp.app.close();
  });

  it('allows bulk-import requests beyond the default JSON limit to reach auth', async () => {
    const response = await request(testApp.server)
      .post('/workspaces/unknown/documents/bulk')
      .send({
        documents: [
          {
            type: 'FILE',
            name: 'large.txt',
            path: 'large.txt',
            content: 'x'.repeat(150 * 1024),
          },
        ],
      });

    expect(response.status).toBe(401);
  });

  it('allows single-document writes beyond the default JSON limit to reach auth', async () => {
    const createResponse = await request(testApp.server)
      .post('/workspaces/unknown/documents')
      .send({
        type: 'FILE',
        name: 'large.txt',
        path: 'large.txt',
        content: 'x'.repeat(150 * 1024),
      });
    const updateResponse = await request(testApp.server)
      .patch('/documents/unknown')
      .send({ content: 'x'.repeat(150 * 1024) });

    expect(createResponse.status).toBe(401);
    expect(updateResponse.status).toBe(401);
  });

  it('persists supported writes over 100 KB and rejects direct content PATCH', async () => {
    const initialContent = 'a'.repeat(150 * 1024);
    const updatedContent = 'b'.repeat(180 * 1024);
    const created = await agent
      .post(`/workspaces/${workspaceId}/documents`)
      .send({
        type: 'FILE',
        name: 'large.txt',
        path: 'large.txt',
        content: initialContent,
      })
      .expect(201);
    expect(created.body.content).toHaveLength(initialContent.length);

    const rejectedUpdate = await agent
      .patch(`/documents/${created.body.id as string}`)
      .send({ content: updatedContent })
      .expect(400);
    expect(rejectedUpdate.body.message).toContain('PATCH cannot set content');

    const bulk = await agent
      .post(`/workspaces/${workspaceId}/documents/bulk`)
      .send({
        documents: [
          {
            type: 'FILE',
            name: 'bulk-large.txt',
            path: 'bulk-large.txt',
            content: initialContent,
          },
        ],
      })
      .expect(201);
    expect(bulk.body[0].content).toHaveLength(initialContent.length);
  });

  it('returns 413 when a single document exceeds the semantic 1 MiB limit', async () => {
    await agent
      .post(`/workspaces/${workspaceId}/documents`)
      .send({
        type: 'FILE',
        name: 'too-large.txt',
        path: 'too-large.txt',
        content: 'x'.repeat(1024 * 1024 + 1),
      })
      .expect(413);
  });

  it('keeps the default JSON limit on ordinary endpoints', async () => {
    const response = await request(testApp.server)
      .post('/auth/login')
      .send({ email: `${'x'.repeat(150 * 1024)}@example.com`, password: 'irrelevant' });

    expect(response.status).toBe(413);
  });

  it('reports malformed JSON as a safe client error', async () => {
    const response = await request(testApp.server)
      .post('/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email":');

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      error: 'Bad Request',
      message: 'Malformed JSON request body',
    });
  });
});
