"use client";
import Link from "next/link";
import Image from "next/image";
import { motion, useInView } from "motion/react";
import { useRef } from "react";
import { Icon } from "@iconify/react";
import { BeneifitImage } from "@/app/api/data";

const Benefit = () => {
  const ref = useRef(null);

  return (
    <section className="dark:bg-darkmode py-14 overflow-x-hidden">
      <div className="container lg:max-w-(--breakpoint-xl) md:max-w-(--breakpoint-md) px-4 mx-auto">
        <div
          ref={ref}
          className="dark:bg-midnight_text bg-hero-bg rounded-3xl md:py-20 py-10 2xl:pr-14 2xl:pl-20 sm:px-14 px-6"
        >
          <div className="items-start">
            <h2 className="font-bold md:text-35 sm:text-28 text-24 text-midnight_text dark:text-white">
              How will
              <span className="bg-border dark:bg-darkHeroBg rounded-lg text-primary max-w-max ml-2">
                online payment
              </span>
              <br />
              platform benefit your product.
            </h2>
          </div>
          <div className="grid grid-cols-12 items-center mt-16 md:gap-12 sm:gap-8">
            <div className="xl:col-span-6 col-span-12 sm:block hidden">
              <div className="xl:px-0 lg:px-20">
                <Image
                  src="/images/benefit/benefit.svg"
                  alt="image"
                  width={500}
                  height={350}
                  style={{ width: "100%", height: "100%" }}
                />
              </div>
            </div>
            <div className="xl:col-span-6 col-span-12" >
              <p className="sm:text-25 text-18 text-midnight_text font-medium dark:text-white">
                Grow revenues and delight your customers by building financial
                features.
              </p>
              {BeneifitImage.map((item, index) => (
                <div key={index} className="sm:flex items-center mt-8">
                  <Image
                    src={item.image}
                    alt="Trusted brand"
                    width={100}
                    height={100}
                    className="w-8 h-8 sm:mr-4 sm:mb-0 mb-3 "
                  />
                  <p className="text-17 text-muted dark:text-white/60">
                    {item.details}
                  </p>
                </div>
              ))}
              <div className="flex items-center lg:justify-start justify-center">
                <Link
                  href="/contact"
                  className="text-17 flex gap-3 items-center bg-primary text-white py-3 px-8 rounded-lg  mt-12 border border-primary hover:text-primary hover:bg-transparent"
                >
                  Content Us
                  <Icon
                    icon="solar:alt-arrow-right-linear"
                    width="13"
                    height="13"
                  />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Benefit;
