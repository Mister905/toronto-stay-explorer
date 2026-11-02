import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: 'http://localhost:5173',
  });

  // Allow providers to clean up when Nest shuts down.
  app.enableShutdownHooks();

  await app.listen(process.env.PORT ?? 3000);
}

await bootstrap();
