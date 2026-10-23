REVOKE ALL ON TABLE "public"."guard_authorizations" FROM "service_role";

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE "public"."guard_authorizations" TO "service_role";

