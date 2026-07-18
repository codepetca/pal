-- Runs once, on first initialisation of the postgres volume.
-- Integration tests truncate tables between cases, so they get their own
-- database rather than sharing the one you develop against.
CREATE DATABASE pal_test;
