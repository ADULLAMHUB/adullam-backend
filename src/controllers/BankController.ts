import { Controller, Get, Route, Tags } from "tsoa";
import { Adullam } from "../../services/BankService.js";
@Route("adullam")
@Tags("Adullam")
export class UsersController extends Controller {

  @Get("/adullam")
  public async getUsers() {
    const message = await Adullam.getMessage()
    return {
      message: "Balance Fetched Successfully",
      data: message
    };
  }
}
