import { Router, Request, Response } from "express";

const rootRouter = Router();

rootRouter.get("/", (req: Request, res: Response) => {
  res.send("Skyjo API");
});

export default rootRouter;
