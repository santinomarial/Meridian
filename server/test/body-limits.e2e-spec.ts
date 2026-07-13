import request from 'supertest';
import { createTestApp, type TestApp } from './utils/test-app';

describe('HTTP body limits', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
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
