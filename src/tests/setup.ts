process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgres://image_service:image_service@localhost:5432/image_service';
process.env.JWT_SECRET ??= 'test-secret-with-at-least-32-characters';
