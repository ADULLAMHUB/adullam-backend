import { Controller, Get, Route, Tags } from "tsoa";
@Route("adullam")
@Tags("Adullam")
export class UsersController extends Controller {
  @Get("/health")
  public static async Health() {
    return {
        message: 'Health'
    }
  }
}
