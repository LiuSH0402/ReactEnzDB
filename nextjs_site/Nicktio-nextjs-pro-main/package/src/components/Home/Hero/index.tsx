"use client";
import Image from "next/image";
import Link from "next/link";
import { motion } from "motion/react";
import { Icon } from "@iconify/react";
import { Heroimage } from "@/app/api/data";

const Hero = () => {
  const leftAnimation = {
    initial: { x: "-10%", opacity: 0 },
    animate: { x: 0, opacity: 1 },
    exit: { x: "-10%", opacity: 0 },
    transition: { duration: .5 },
  };

  const rightAnimation = {
    initial: { x: "10%", opacity: 0 },
    animate: { x: 0, opacity: 1 },
    exit: { x: "10%", opacity: 0 },
    transition: { duration: .5 },
  };
  return (
    <section className="relative pt-44 bg-cover bg-center dark:bg-darkmode">
      <div className="w-full h-full absolute z-0 bg-hero-bg sm:rounded-b-[119px] sm:-left-1/4 2xl:-left-1/3 top-0 dark:bg-midnight_text"></div>
      <div className="container mx-auto lg:max-w-(--breakpoint-xl) relative z-1 md:max-w-(--breakpoint-md) px-4">
        <div className="grid grid-cols-12 items-center">
          <motion.div {...leftAnimation} className="lg:col-span-6 col-span-12">
            <h1 className="md:text-50 sm:text-40 text-28 text-midnight_text dark:text-white lg:text-start mb-6 lg:w-full sm:w-3/4">
              Quickest and easiest
              <br />
              <span className="bg-border dark:bg-darkHeroBg md:text-50 text-36 rounded-lg lg:text-start text-primary max-w-max">
                online payment
              </span>
              <br />
              platform for your product.
            </h1>
            <p className="sm:text-19 text-16 text-muted dark:text-white/60 text-start lg:max-w-full sm:max-w-75%">
              Embed powerful financial features into your product, Build in
              minutes, launch in weeks.
            </p>
            <div className="flex md:flex-nowrap flex-wrap items-center mt-12 sm:gap-11 gap-6">
              <div>
                <Link
                  href="/#started"
                  className="text-17 flex gap-2 items-center bg-primary text-white py-3 px-8 rounded-lg border border-primary hover:text-primary hover:bg-transparent"
                >
                  Get Started
                  <Icon
                    icon="solar:alt-arrow-right-linear"
                    width="13"
                    height="13"
                  />
                </Link>
              </div>
              <div>
                <Link
                  href="/services"
                  className="text-17 flex gap-2 items-center text-muted dark:text-white/60 hover:text-primary hover:dark:text-primary"
                >
                  See Features
                  <Icon
                    icon="solar:alt-arrow-right-linear"
                    width="13"
                    height="13"
                  />
                </Link>
              </div>
            </div>

            <div className="lg:my-28 my-12">
              <p className="text-20 text-muted dark:text-white/60 text-start mb-7">
                Trusted by
              </p>
              <div className="flex space-x-6 justify-start w-full">
                {Heroimage.map((item, index) => (
                  <Link key={index} href="/">
                    <Image
                      src={item.lightimage}
                      alt="image"
                      width={115}
                      height={30}
                      className="block dark:hidden"
                      style={{ width: "100%", height: "100%" }}
                    />
                    <Image
                      src={item.darkimage}
                      alt="image"
                      width={115}
                      height={30}
                      className="hidden dark:block"
                      style={{ width: "100%", height: "100%" }}
                    />
                  </Link>
                ))}
              </div>
            </div>
          </motion.div>
          <motion.div
            {...rightAnimation}
            className="lg:col-span-6 col-span-12 pl-20 lg:block hidden"
          >
            <Image
              src="/images/hero/hero-image.png"
              alt="image"
              width={498}
              height={651}
              className="w-full h-full object-cover"
            />
          </motion.div>
        </div>
      </div>
    </section>
  );
};

export default Hero;
