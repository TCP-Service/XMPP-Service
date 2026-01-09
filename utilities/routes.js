import fs from 'fs';
import path from 'path';
import { pathToFileURL, fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function routesFromDir(app, dirPath) {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        await routesFromDir(app, fullPath);
      } else if (
        entry.isFile() &&
        (entry.name.endsWith('.js') || entry.name.endsWith('.ts'))
      ) {
        try {
          const fileUrl = pathToFileURL(fullPath);
          const routeModule = await import(fileUrl.href);

          const route = routeModule.default || routeModule;
          
          if (typeof route === 'function') {
            try {
              route(app);
            } catch (configError) {
              try {
                app.use(route);
              } catch (middlewareError) {
                console.error(`Failed to register route from ${fullPath}:`, {
                  configError,
                  middlewareError
                });
              }
            }
          } else if (route) {
            app.use(route);
          }
        } catch (error) {
          console.error(`Error importing route from ${fullPath}:`, error);
        }
      }
    }
  } catch (error) {
    console.error(`Error registering routes from ${dirPath}:`, error);
  }
}

export default async function registerRoutes(app) {
  await routesFromDir(app, path.join(__dirname, '../rest'));
}